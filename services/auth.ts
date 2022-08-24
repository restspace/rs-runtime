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
import { SimpleServiceContext } from "../../rs-core/ServiceContext.ts";

interface AuthServiceConfig extends IServiceConfig {
    userUrlPattern: string;
    loginPage?: string;
    impersonateRoles?: string;
}

const jwtExpiryMins = 30;

const service = new AuthService<IAdapter, AuthServiceConfig>();

async function setJwt(msg: Message, user: AuthUser) {
    const jwt = await config.authoriser.getJwt(user);
    const timeToExpirySecs = jwtExpiryMins * 60;
    const cookieOptions = new CookieOptions({ httpOnly: true, maxAge: timeToExpirySecs });
    if (msg.url.scheme === 'https://') {
        cookieOptions.sameSite = SameSiteValue.none;
        cookieOptions.secure = true;
    }
    msg.setCookie('rs-auth', jwt, cookieOptions);
    return timeToExpirySecs;
}

async function login(msg: Message, userUrlPattern: string, context: SimpleServiceContext): Promise<Message> {
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
        const timeToExpirySecs = await setJwt(msg, user);
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
    const newMsg = await login(msg, config.userUrlPattern!, context);
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
                context.logger.info(`authenticationService redirect from ${msg.url} to add suceed query to ${redirUrl}`);
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
    const user = await getUserFromEmail(context, config.userUrlPattern!, msg, msg.user.email);
    if (user) {
        user.exp = msg.user.exp;
        return msg.setDataJson(user);
    } else {
        return msg.setStatus(404, "No such user");
    }
});

service.setUser(async (msg) => {
    const authCookie = msg.getCookie('rs-auth') || msg.getHeader('authorization');
    if (!authCookie) return msg;

    // OPTIONS requests should never be authenticated so all errors don't become CORS errors
    let authResult: IJwtPayload | string = '';
    if (msg.method !== "OPTIONS") {
        authResult = await config.authoriser.verifyJwtHeader(msg.getHeader('authorization'), authCookie, msg.url.path);
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
        const refreshTime = (msg.user.exp || 0) - jwtExpiryMins * 60 * 1000 / 2;
        const nowTime = new Date().getTime();
        if (nowTime > refreshTime) {
            const timeToExpirySecs = await setJwt(msg, msg.user as AuthUser);
            const newExpiryTime = nowTime + timeToExpirySecs * 1000;
            msg.user.exp = newExpiryTime;
            config.logger.info(`refreshed to ${new Date(newExpiryTime)}`);
        }
    }

    return msg;
});

export default service;