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
import { config as runtimeConfig } from "../config.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { isAllowedLoginDomain, isSameDomainBrowserRequest, isTrustedLoginDomain } from "../auth/browserOrigin.ts";
import { AuthSource, setAuthSource } from "../auth/AuthSource.ts";

interface AuthServiceConfig extends IServiceConfig {
    userUrlPattern: string;
    loginPage?: string;
    allowedLoginDomains?: string[];
    trustedDomains?: string[];
    impersonateRoles?: string;
    sessionTimeoutMins?: number;
    jwtUserProps?: string[];
    mfa?: {
        mode?: "challenge" | "singleStep";
        totpServiceUrl?: string;
        mfaCookieName?: string;
        mfaTimeoutMins?: number;
    };
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

function isHttpsRequest(msg: Message): boolean {
    const forwardedProto = (msg.getHeader("x-forwarded-proto") || "").toLowerCase();
    if (forwardedProto === "https") return true;
    if (runtimeConfig.server?.incomingAlwaysHttps) return true;
    return msg.url.scheme === "https://";
}

function getLoginCookiePolicy(msg: Message, config: AuthServiceConfig) {
    const sameDomainLogin = isSameDomainBrowserRequest(msg);
    const trustedDomainLogin = isTrustedLoginDomain(msg, config);
    return {
        setCookie: sameDomainLogin || trustedDomainLogin,
        strictCookie: sameDomainLogin && !trustedDomainLogin
    };
}

async function setJwt(
    msg: Message,
    payload: Record<string, unknown>,
    expiryMins: number,
    options?: { setCookie?: boolean; strictCookie?: boolean; }
) {
    const timeToExpirySecs = expiryMins * 60;
    const jwt = await runtimeConfig.authoriser.getJwtForPayload(payload, timeToExpirySecs);
    const setCookie = options?.setCookie !== false;
    if (setCookie) {
        const cookieOptions = new CookieOptions({ httpOnly: true, maxAge: timeToExpirySecs });
        if (options?.strictCookie) {
            cookieOptions.sameSite = SameSiteValue.strict;
            if (isHttpsRequest(msg)) cookieOptions.secure = true;
        } else if (isHttpsRequest(msg)) {
            cookieOptions.sameSite = SameSiteValue.none;
            cookieOptions.secure = true;
        }
        msg.setCookie("rs-auth", jwt, cookieOptions);
    }
    return { timeToExpirySecs, jwt, cookieSet: setCookie };
}

async function setMfaJwt(
    msg: Message,
    payload: Record<string, unknown>,
    expiryMins: number,
    cookieName: string,
    options?: { setCookie?: boolean; strictCookie?: boolean; }
) {
    const timeToExpirySecs = expiryMins * 60;
    const jwt = await runtimeConfig.authoriser.getJwtForPayload(payload, timeToExpirySecs);
    const setCookie = options?.setCookie !== false;
    if (setCookie) {
        const cookieOptions = new CookieOptions({ httpOnly: true, maxAge: timeToExpirySecs });
        if (options?.strictCookie) {
            cookieOptions.sameSite = SameSiteValue.strict;
            if (isHttpsRequest(msg)) cookieOptions.secure = true;
        } else if (isHttpsRequest(msg)) {
            cookieOptions.sameSite = SameSiteValue.none;
            cookieOptions.secure = true;
        }
        msg.setCookie(cookieName, jwt, cookieOptions);
    }
    return { timeToExpirySecs, jwt, cookieSet: setCookie };
}

function deleteCookieWithSecurity(msg: Message, name: string) {
    const cookieOptions = new CookieOptions({ httpOnly: true, expires: new Date(2000, 0, 1) });
    if (isHttpsRequest(msg)) {
        cookieOptions.sameSite = SameSiteValue.none;
        cookieOptions.secure = true;
    }
    msg.setCookie(name, "", cookieOptions);
    return msg;
}

function getMfaCookieName(serviceConfig: AuthServiceConfig): string {
    const configured = (serviceConfig.mfa?.mfaCookieName || "rs-mfa").toString().trim() || "rs-mfa";
    // Never allow collisions with the real auth cookie.
    if (configured === "rs-auth") {
        runtimeConfig.logger.warn("auth.mfaCookieName must not be rs-auth; using rs-mfa instead");
        return "rs-mfa";
    }
    return configured;
}

function redactUserForClient(user: any) {
    if (!user || typeof user !== "object") return user;
    const out = { ...user };
    // Never leak secrets / internal state
    if (out.totp && typeof out.totp === "object") {
        out.totp = {
            enabled: !!out.totp.enabled,
            confirmedAt: out.totp.confirmedAt,
            digits: out.totp.digits,
            periodSeconds: out.totp.periodSeconds,
            issuer: out.totp.issuer
        };
    }
    delete out.secretEnc;
    return out;
}

function userRequiresTotp(fullUser: any): boolean {
    if (!fullUser || typeof fullUser !== "object") return false;
    if (fullUser.mfaEnabled === true) return true;
    if (fullUser.totp && typeof fullUser.totp === "object" && fullUser.totp.enabled === true) return true;
    return false;
}

async function totpVerifyInternal(msg: Message, context: SimpleServiceContext, serviceConfig: AuthServiceConfig, email: string, code: string) {
    const totpBase = (serviceConfig.mfa?.totpServiceUrl || "/mfa").toString();
    const verifyUrl = totpBase.endsWith("/") ? `${totpBase}verify` : `${totpBase}/verify`;
    const verifyMsg = msg.copy()
        .setMethod("POST")
        .setUrl(verifyUrl)
        .setDataJson({ email, code });
    verifyMsg.internalPrivilege = true;
    const verifyOut = await context.makeRequest(verifyMsg);
    if (!verifyOut.ok) {
        return { ok: false, required: true, error: (await verifyOut.data?.asString().catch(() => "")) || "verify error" };
    }
    const data = await verifyOut.data?.asJson().catch(() => null);
    return data || { ok: false, required: true };
}

async function login(msg: Message, userUrlPattern: string, context: SimpleServiceContext, config: AuthServiceConfig): Promise<Message> {
    if (!isAllowedLoginDomain(msg, config)) {
        return msg.setStatus(403, "Login origin not allowed");
    }
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
    const loginCookiePolicy = getLoginCookiePolicy(msg, config);
    try {
        // Option B: challenge flow when user requires MFA
        const mfaMode = config.mfa?.mode || "singleStep";
        if (mfaMode === "challenge" && userRequiresTotp(fullUser)) {
            const cookieName = getMfaCookieName(config);
            const timeoutMins = config.mfa?.mfaTimeoutMins || 5;
            const mfaJwtResult = await setMfaJwt(msg, { email: user.email, mfaPending: true }, timeoutMins, cookieName, {
                setCookie: loginCookiePolicy.setCookie,
                strictCookie: loginCookiePolicy.strictCookie
            });
            const out: Record<string, unknown> = { mfaRequired: true, type: "totp" };
            if (!mfaJwtResult.cookieSet) {
                out._jwt = mfaJwtResult.jwt;
            }
            return msg.setDataJson(out).setStatus(202);
        }

        const payload = buildJwtPayload(user, fullUser as unknown as Record<string, unknown>, config.jwtUserProps);
        const jwtResult = await setJwt(msg, payload, config.sessionTimeoutMins || 30, {
            setCookie: loginCookiePolicy.setCookie,
            strictCookie: loginCookiePolicy.strictCookie
        });
        fullUser.password = user.passwordMask();
        fullUser.exp = (new Date().getTime()) + jwtResult.timeToExpirySecs * 1000;
        const clientUser = redactUserForClient(fullUser) as Record<string, unknown>;
        if (!jwtResult.cookieSet) {
            clientUser._jwt = jwtResult.jwt;
        }
        return msg.setDataJson(clientUser);
    } catch (err) {
        context.logger.error('get jwt error: ' + err);
        return msg.setStatus(500, 'internal error');
    }
}

function logout(msg: Message): Promise<Message> {
    deleteCookieWithSecurity(msg, "rs-auth");
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
            if (redirUrl.query['redirect']?.length) {
                const redirectTarget = redirUrl.query['redirect'][0];
                let isValidRedirect = false;
                try {
                    const redirectUrl = new Url(redirectTarget);
                    // Allow relative paths (no domain) or same origin (same scheme + domain)
                    isValidRedirect = !redirectUrl.domain || (redirectUrl.scheme === msg.url.scheme && redirectUrl.domain === msg.url.domain);
                } catch {}
                if (isValidRedirect) {
                    context.logger.info(`authenticationService redirect from ${msg.url} by query arg to ${redirectTarget}`);
                    newMsg.redirect(new Url(redirectTarget), true);
                } else {
                    context.logger.warn(`authenticationService blocked redirect to external URL: ${redirectTarget}`);
                    // Redirect to login page without redirect param instead
                    const { redirect: _redirect, ...queryWithoutRedirect } = redirUrl.query;
                    redirUrl.query = { ...queryWithoutRedirect, 'result': [ 'succeed' ] };
                    newMsg.redirect(redirUrl, true);
                }
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

// Option B completion: exchange rs-mfa + totp code for rs-auth
service.postPath("mfa/totp", async (msg, context, config) => {
    if (!isAllowedLoginDomain(msg, config)) {
        return msg.setStatus(403, "Login origin not allowed");
    }
    const cookieName = getMfaCookieName(config);
    const mfaCookie = msg.getCookie(cookieName) || "";
    const authHeader = msg.getHeader("authorization") || "";
    if (!mfaCookie && !authHeader) {
        return msg.setStatus(401, "Missing mfa cookie");
    }
    const authResult = await runtimeConfig.authoriser.verifyJwtHeader(authHeader, mfaCookie, msg.url.path);
    if (typeof authResult === "string" || !authResult.email || (authResult as any).mfaPending !== true) {
        return msg.setStatus(401, "Invalid mfa token");
    }
    const body = msg.data ? await msg.data.asJson().catch(() => ({} as any)) : ({} as any);
    const code = (body?.code || "").toString();
    if (!code) {
        return msg.setStatus(400, "Missing code");
    }

    const verify = await totpVerifyInternal(msg, context, config, authResult.email, code);
    if (!verify?.ok) {
        if (verify?.locked) return msg.setStatus(423, "Locked");
        return msg.setStatus(401, "Bad code");
    }

    const fullUser = await getUserFromEmail(context, config.userUrlPattern!, msg, authResult.email, true);
    if (!fullUser) return msg.setStatus(404, "no user record");
    const user = new AuthUser(fullUser);
    const payload = buildJwtPayload(user, fullUser as unknown as Record<string, unknown>, config.jwtUserProps);
    const loginCookiePolicy = getLoginCookiePolicy(msg, config);
    const jwtResult = await setJwt(msg, payload, config.sessionTimeoutMins || 30, {
        setCookie: loginCookiePolicy.setCookie,
        strictCookie: loginCookiePolicy.strictCookie
    });
    deleteCookieWithSecurity(msg, cookieName);
    fullUser.password = user.passwordMask();
    fullUser.exp = (new Date().getTime()) + jwtResult.timeToExpirySecs * 1000;
    const clientUser = redactUserForClient(fullUser) as Record<string, unknown>;
    if (!jwtResult.cookieSet) {
        clientUser._jwt = jwtResult.jwt;
    }
    return msg.setDataJson(clientUser);
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
        return msg.setDataJson({ ...redactUserForClient(user), ...sessionInfo });   
    } else {
        return msg.setStatus(404, "No such user");
    }
});

service.getPath('timeout', (msg, _context, config) =>
    msg.setData((config.sessionTimeoutMins || 30).toString(), "text/plain"));

service.setUser(async (msg, _context, serviceConfig) => {
    const sessionTimeoutMins = serviceConfig.sessionTimeoutMins;
    const existingAuthCookie = msg.getCookie("rs-auth");
    const authHeader = msg.getHeader('authorization') || "";
    const authCookie = existingAuthCookie || authHeader;
    const attemptedAuthSource: AuthSource | undefined = authHeader ? "authorization" : existingAuthCookie ? "cookie" : undefined;
    setAuthSource(msg);
    if (!authCookie) return msg;

    // OPTIONS requests should never be authenticated so all errors don't become CORS errors
    let authResult: IJwtPayload | string = '';
    if (msg.method !== "OPTIONS") {
        authResult = await runtimeConfig.authoriser.verifyJwtHeader(authHeader, authCookie, msg.url.path);
    }
    authResult = authResult || 'anon';

    if (typeof authResult === "string") {
        msg.user = new AuthUser({});
        setAuthSource(msg);
    } else {
        setAuthSource(msg, attemptedAuthSource);
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
            const shouldRefreshCookie = !!existingAuthCookie;
            const strictRefreshCookie = !isTrustedLoginDomain(msg, serviceConfig);
            const jwtResult = await setJwt(msg, payload, sessionTimeoutMins || 30, {
                setCookie: shouldRefreshCookie,
                strictCookie: strictRefreshCookie
            });
            const newExpiryTime = nowTime + jwtResult.timeToExpirySecs * 1000;
            msg.user.exp = newExpiryTime;
            runtimeConfig.logger.info(`refreshed to ${new Date(newExpiryTime)}`);
        }
    }

    return msg;
});

export default service;
