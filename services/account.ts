import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { getUserFromEmail, saveUser } from "rs-core/user/userManagement.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { TokenVerification } from "../auth/Authoriser.ts";
import { Url } from "rs-core/Url.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { IAuthUser } from "rs-core/user/IAuthUser.ts";
import { config } from "../config.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

interface AccountSubservice {
    tokenExpiryMins?: number;
    returnPageUrl: string;
    emailTemplateUrl: string;
}

interface AccountServiceConfig extends IServiceConfig {
    userUrlPattern: string;
    emailSendUrlPattern: string;
    passwordReset?: AccountSubservice;
    emailConfirm?: AccountSubservice;
}

const service = new Service<IAdapter, AccountServiceConfig>();

const sendTokenUrl = async (msg: Message, context: ServiceContext<IAdapter>, serviceConfig: AccountServiceConfig, subservice: AccountSubservice): Promise<Message> => {
    if (msg.url.servicePathElements.length < 1) return msg.setStatus(400, 'Missing email');

    const user = await getUserFromEmail(context, serviceConfig.userUrlPattern, msg, msg.url.servicePathElements[0], true);
    if (!user) return msg.setStatus(400, 'No such user');

    user.token = await config.authoriser.generateToken();
    const expiry = new Date().getTime() + (subservice.tokenExpiryMins || 30) * 1000 * 60;
    user.tokenExpiry = new Date(expiry);

    const saveOutMsg = await saveUser(context, serviceConfig.userUrlPattern, msg, user, true);
    if (!saveOutMsg.ok) return saveOutMsg;

    const returnPageUrl = new Url(subservice.returnPageUrl);
    if (!returnPageUrl.domain) {
        returnPageUrl.scheme = msg.url.scheme;
        returnPageUrl.domain = config.tenants[context.tenant].primaryDomain;
    }
    returnPageUrl.query = {
        token: [ user.token ],
        email: [ user.email ]
    };
    (user as AuthUser & { returnPageUrl: string })['returnPageUrl'] = returnPageUrl.toString();

    const templateMsg = msg.copy()
        .setMethod('POST')
        .setUrl(subservice.emailTemplateUrl)
        .setDataJson(user);

    const emailMsg = await context.makeRequest(templateMsg);
    if (!emailMsg.ok) return emailMsg;
    emailMsg.url = Url.fromPathPattern(serviceConfig.emailSendUrlPattern, msg.url, { email: user.email });
    emailMsg.method = 'POST';

    const outMsg = await context.makeRequest(emailMsg);
    return outMsg; 
}

const tokenUserUpdate = async (msg: Message, context: ServiceContext<IAdapter>, serviceConfig: AccountServiceConfig, updateUser: (u: IAuthUser, postData: Record<string, unknown>) => Promise<AuthUser>): Promise<Message> => {
    if (msg.url.servicePathElements.length < 1) return msg.setStatus(400, 'Missing email');
    const json = await msg.data!.asJson();
    
    let user = await getUserFromEmail(context, serviceConfig.userUrlPattern, msg, msg.url.servicePathElements[0], true);
    if (!user) return msg.setStatus(400, 'No such user');
    const verification = await config.authoriser.verifyToken(json.token, user);
    if (verification !== TokenVerification.ok) {
        let statusMsg = 'Unknown';
        switch (verification) {
            case TokenVerification.noMatch:
                statusMsg = 'Bad token';
                break;
            case TokenVerification.expired:
                statusMsg = 'Expired';
                break;
            case TokenVerification.used:
                statusMsg = 'Token used';
                break;
        }
        return msg.setStatus(401, statusMsg);
    }
    user = await updateUser(user, json);
    delete user.tokenExpiry; // indicates token was used, but leaves token on record

    const outMsg = await saveUser(context, serviceConfig.userUrlPattern, msg, user, true);
    outMsg.setData(null, '');
    return outMsg;
}

const tokenPasswordSchema = {
    type: 'object',
    properties: {
        token: { type: 'string' },
        password: { type: 'string' }
    }
}

const tokenVerifySchema = {
    type: "object",
    properties: {
        token: { type: "string" }
    }
}

service.postPath('reset-password', (msg, context, config) => {
    if (!config.passwordReset) return Promise.resolve(msg.setStatus(404, 'Not found'));
    return sendTokenUrl(msg, context, config, config.passwordReset);
});

service.postPath('token-update-password', (msg, context, config) => {
    return tokenUserUpdate(msg, context, config, async (userData, posted) => {
        const user = new AuthUser(userData);
        user.password = posted['password'] as string;
        await user.hashPassword();
        return user;
    });
}, tokenPasswordSchema);

service.postPath('verify-email', (msg, context, config) => {
    if (!config.emailConfirm) return Promise.resolve(msg.setStatus(404, 'Not found'));
    return sendTokenUrl(msg, context, config, config.emailConfirm);
});

service.postPath('confirm-email', (msg, context, config) => {
    return tokenUserUpdate(msg, context, config, (userData, _posted) => {
        const user = new AuthUser(userData);
        (user as AuthUser & { emailVerified: Date }).emailVerified = new Date();
        return Promise.resolve(user);
    });
}, tokenVerifySchema);

export default service;