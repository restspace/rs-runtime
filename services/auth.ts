import { Message } from "rs-core/Message.ts";
import { AuthService } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { getUserFromEmail } from "rs-core/user/userManagement.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { IJwtPayload } from "../auth/Authoriser.ts";
import { CookieOptions, SameSiteValue } from "rs-core/CookieOptions.ts";
import { Url } from "rs-core/Url.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { userIsAnon } from "rs-core/user/IAuthUser.ts";
import { config } from "../config.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";

interface AuthServiceConfig extends IServiceConfig {
    userUrlPattern: string;
    loginPage?: string;
    impersonateRoles?: string;
    sessionTimeoutMins?: number;
    jwtUserProps?: string[];
}

const service = new AuthService<IAdapter, AuthServiceConfig>();

const blockedJwtUserProps = new Set([
    "password",
    "token",
    "tokenExpiry",
    "exp"
]);

const reservedJwtClaims = new Set([
    "email",
    "roles",
    "originalEmail",
    "exp"
]);

function isSafeJwtClaimValue(value: unknown): value is string | number | boolean {
    if (value === null || value === undefined) return false;
    const t = typeof value;
    return t === "string" || t === "number" || t === "boolean";
}

function buildJwtPayload(baseUser: AuthUser, source: Record<string, unknown>, jwtUserProps?: string[]) {
    const payload: Record<string, unknown> = {
        email: baseUser.email,
        roles: baseUser.roles
    };
    if (baseUser.originalEmail) {
        payload.originalEmail = baseUser.originalEmail;
    }

    if (Array.isArray(jwtUserProps)) {
        for (const prop of jwtUserProps) {
            if (!prop || typeof prop !== "string") continue;
            if (blockedJwtUserProps.has(prop) || reservedJwtClaims.has(prop)) continue;
            const value = source[prop];
            if (!isSafeJwtClaimValue(value)) continue;
            payload[prop] = value;
        }
    }

    return payload;
}

async function setJwt(msg: Message, payload: Record<string, unknown>, expiryMins: number) {
    const timeToExpirySecs = expiryMins * 60;
    const jwt = await config.authoriser.getJwtForPayload(payload, timeToExpirySecs);
    const cookieOptions = new CookieOptions({ httpOnly: true, maxAge: timeToExpirySecs });
    if (msg.url.scheme === 'https://') {
        cookieOptions.sameSite = SameSiteValue.none;
        cookieOptions.secure = true;
    }
    msg.setCookie('rs-auth', jwt, cookieOptions);
    return timeToExpirySecs;
}

async function login(msg: Message, userUrlPattern: string, context: SimpleServiceContext, config: AuthServiceConfig): Promise<Message> {
    const userSpec = await msg.data!.asJson();
    const fullUser = await getUserFromEmail(context, userUrlPattern, msg, userSpec.email, true);
    if (!fullUser) {
        return msg.setStatus(404, 'no user record');
    }
    const user = new AuthUser(fullUser);
    const match = await user.matchPassword(userSpec.password);
    if (!match) {
        return msg.setStatus(400, 'bad password');
    }
    try {
        const payload = buildJwtPayload(user, fullUser as unknown as Record<string, unknown>, config.jwtUserProps);
        const timeToExpirySecs = await setJwt(msg, payload, config.sessionTimeoutMins || 30);
        fullUser.password = user.passwordMask();
        fullUser.exp = (new Date().getTime()) + timeToExpirySecs * 1000;
        return msg.setDataJson(fullUser);
    } catch (err) {
        context.logger.error('get jwt error: ' + err);
        return msg.setStatus(500, 'internal error');
    }
}

function logout(msg: Message): Promise<Message> {
    msg.deleteCookie('rs-auth');
    return Promise.resolve(msg);
}

service.postPath('login', async (msg, context, config) => {
    const newMsg = await login(msg, config.userUrlPattern!, context, config);
    if (config.loginPage && msg.getHeader('referer')) {
        let redirUrl = msg.url.copy();
        try {
            redirUrl = new Url(msg.getHeader('referer'));
        } catch {}
        if (redirUrl.path !== config.loginPage) return newMsg; // referer must be login page
        if (newMsg.ok) {
            if (redirUrl.query['redirect'].length) {
                context.logger.info(`authenticationService redirect from ${msg.url} by query arg to ${redirUrl}`);
                newMsg.redirect(new Url(redirUrl.query['redirect'][0]), true);
            } else {
                redirUrl.query = { ...redirUrl.query, 'result': [ 'succeed' ] };
                context.logger.info(`authenticationService redirect from ${msg.url} to add succeed query to ${redirUrl}`);
                newMsg.redirect(redirUrl, true);
            }
        } else {
            redirUrl.query = { ...redirUrl.query, 'result': [ 'fail' ] };
            context.logger.info(`authenticationService redirect from ${msg.url} to add fail query to ${redirUrl}`);
            newMsg.redirect(redirUrl, true);
        }
    }
    return newMsg;
});

service.postPath('logout', (msg) => logout(msg));

service.getPath('user', async (msg, context, config) => {
    if (!msg.user || userIsAnon(msg.user)) {
        return msg.setStatus(401, 'Unauthorized');
    }
    const user = (await getUserFromEmail(context, config.userUrlPattern!, msg, msg.user.email));
    if (user) {
        user.exp = msg.user.exp;
        const sessionInfo = {} as { msRemaining?: number }
        if (msg.user.exp) {
            sessionInfo.msRemaining = msg.user.exp - new Date().getTime();
        }
        // Ensure password is masked before returning user data
        const authUser = new AuthUser(user);
        if (user.password && !authUser.passwordIsMaskOrEmpty()) {
            user.password = authUser.passwordMask();
        }
        return msg.setDataJson({ ...user, ...sessionInfo });   
    } else {
        return msg.setStatus(404, "No such user");
    }
});

service.getPath('timeout', (msg, _context, config) =>
    msg.setData((config.sessionTimeoutMins || 30).toString(), "text/plain"));

service.setUser(async (msg, _context, serviceConfig) => {
    const sessionTimeoutMins = serviceConfig.sessionTimeoutMins;
    const authCookie = msg.getCookie('rs-auth') || msg.getHeader('authorization');
    if (!authCookie) return msg;

    // OPTIONS requests should never be authenticated so all errors don't become CORS errors
    let authResult: IJwtPayload | string = '';
    if (msg.method !== "OPTIONS") {
        authResult = await config.authoriser.verifyJwtHeader(msg.getHeader('authorization')!, authCookie, msg.url.path);
    }
    authResult = authResult || 'anon';

    if (typeof authResult === "string") {
        msg.user = new AuthUser({});
    } else {
        msg.user = new AuthUser({
            ...authResult,
            exp: (authResult.exp || 0) * 1000
        });

        // refresh jwt expiry if later than halfway through expiry
        const refreshTime = (msg.user.exp || 0) - (sessionTimeoutMins || 30) * 60 * 1000 / 2;
        const nowTime = new Date().getTime();
        if (nowTime > refreshTime) {
            const refreshUser = msg.user as AuthUser;
            const payload = buildJwtPayload(refreshUser, refreshUser as unknown as Record<string, unknown>, serviceConfig.jwtUserProps);
            const timeToExpirySecs = await setJwt(msg, payload, sessionTimeoutMins || 30);
            const newExpiryTime = nowTime + timeToExpirySecs * 1000;
            msg.user.exp = newExpiryTime;
            config.logger.info(`refreshed to ${new Date(newExpiryTime)}`);
        }
    }

    return msg;
});

export default service;