import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { AuthUser } from "../auth/AuthUser.ts";

function mapLegalChanges(msg: Message, oldValues: AuthUser, newUser: AuthUser | null): AuthUser | null | string {
    const currentUserObj = msg.user || AuthUser.anon;
    const current = new AuthUser(currentUserObj);
    const isRegistration = !oldValues || oldValues.isAnon();
    const isSelfChange = !isRegistration && oldValues.email === current.email;

    // don't save password mask, keep old value
    if (newUser && newUser.passwordIsMaskOrEmpty()) newUser.password = oldValues.password;

    // admin or internal privileged call can change anything
    if (msg.internalPrivilege || current.hasRole("A")) {
        return newUser;
    }

    // it's a deletion: must be the same user
    if (newUser === null) {
        return isSelfChange ? newUser : "can't delete another user";
    }

    // self change can't change role or email
    if (isSelfChange) {
        if (newUser.roles !== oldValues.roles
            || newUser.email !== oldValues.email) {
            return "user can't change their role or email";
        } else {
            return newUser;
        }
    }

    // registration can only set role to 'U'
    if (isRegistration) {
        if (newUser.roles !== 'U') {
            return "registration must set role to U only";
        } else {
            return newUser;
        }
    }
    
    return 'not an allowable change';
}

async function validateChange(msg: Message, context: SimpleServiceContext): Promise<Message> {
    if (!msg.ok || (msg.method !== 'DELETE' && !msg.data) || context.prePost !== "pre" || msg.internalPrivilege || msg.url.isDirectory) {
        msg.internalPrivilege = false;
        return msg;
    }

    let newUser: AuthUser | null;
    try {
        const newUserObj = msg.method === 'DELETE' ? null : await msg.data!.asJson();
        newUser = msg.method === 'DELETE' ? null : new AuthUser(newUserObj);
    } catch {
        return msg.setStatus(400, 'Json misformatted');
    }

    let currUserMsg = msg.copy().setMethod("GET");
    currUserMsg.url.pathElements.shift(); // remove the service name
    currUserMsg.url.isRelative = false;

    currUserMsg.internalPrivilege = true;
    currUserMsg = await context.makeRequest(currUserMsg);
    currUserMsg.internalPrivilege = false;

    let currUser: AuthUser;
    if (currUserMsg.status === 404) {
        currUser = AuthUser.anon;
    } else if (!currUserMsg.ok) {
        msg.data = currUserMsg.data;
        return msg.setStatus(currUserMsg.status);
    } else {
        const currUserObj = await currUserMsg.data!.asJson();
        currUser = new AuthUser(currUserObj);
    }

    if (newUser && !newUser.passwordIsMaskOrEmpty()) {
        try {
            context.logger.info(`user ${newUser.email} setting password to ${newUser.password.substr(0, 3)}...`);
            await newUser.hashPassword();
        } catch {
            return msg.setStatus(500);
        }
    }

    const updatedUser = mapLegalChanges(msg, currUser, newUser);
    if (typeof updatedUser === 'string') {
        context.logger.warning(`illegal user change: ${updatedUser} user: ${JSON.stringify(newUser)}`);
        return msg.setStatus(403, 'illegal user action');
    }

    msg.setDataJson(updatedUser);
    return msg;
}

const service = new Service();

service.get(async (msg: Message, context: SimpleServiceContext) => {
    if (context.prePost !== "post" || !msg.ok || !msg.data || msg.data.mimeType === 'application/schema+json' || msg.url.isDirectory) return msg;

    if (msg.url.query['test'] !== undefined) {
        msg.data = undefined;
        return msg;
    }

    const originalMime = msg.data.mimeType;

    let user: AuthUser;
    try {
        const userObj = await msg.data.asJson();
        user = new AuthUser(userObj);
    } catch {
        if (!msg.ok) return msg;
        return msg.setStatus(500, 'User data misformatted');
    }
    if (!msg.internalPrivilege) {
        user.password = user.passwordMask();
    } else {
        msg.internalPrivilege = false;
    }
    msg.setDataJson(user);
    msg.data.mimeType = originalMime;
    return msg;
});

service.put(validateChange);
service.post(validateChange);
service.delete(validateChange);

export default service;