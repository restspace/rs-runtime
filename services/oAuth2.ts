import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { pathCombine } from "rs-core/utility/utility.ts";
import { Url } from "rs-core/Url.ts";
import { BaseStateClass, contextLoggerArgs } from "rs-core/ServiceContext.ts";

interface IOAuth2Config extends IServiceConfig {
    applicationName: string;
    clientId: string;
    clientSecret: string;
    authUrl: string; // .../o/oauth2/auth
    tokenUrl: string; // .../o/oauth2/token
    scopes: string[];
    extraAuthParams?: Record<string, string>;
    userUrlPattern: string;
    finalRedirectUrl?: string;
}

class OAuthState extends BaseStateClass {
    expiryMs = 1000 * 30;

    async getUserKey(userId: string, redirectUrl?: string) {
        const key = crypto.randomUUID();
        await this.setStore(key, { userId, expiry: Date.now() + this.expiryMs, redirectUrl });
        setTimeout(() => this.deleteStore(key), this.expiryMs);
        return key;
    }

    async getUserInfo(key: string) {
        const state = await this.getStore(key) as number | { userId: string, expiry: number, redirectUrl?: string };
        if (typeof state === 'number') {
            return state;
        }
        if (state && state.expiry > Date.now()) {
            return { userId: state.userId, redirectUrl: state.redirectUrl };
        }
        return null;
    }
}

const service = new Service<IDataAdapter, IOAuth2Config>();

service.getPath('consent', async (msg, context, config) => {
    const redirectUri = "https://"
        + pathCombine(context.primaryDomain, config.basePath, 'redirect');
    const state = await context.state(OAuthState, context, config) as OAuthState;
    const code = await state.getUserKey(msg.user?.email || '');
    const authUrl = config.authUrl
        + "?client_id=" + config.clientId
        + "&redirect_uri=" + encodeURIComponent(redirectUri)
        + "&scope=" + config.scopes.join(' ')
        + "&response_type=code"
        + "&state=" + code
        + (config.extraAuthParams ? "&" + new URLSearchParams(config.extraAuthParams).toString() : "");
    return msg.redirect(new Url(authUrl), true);
});

service.getPath('redirect', async (msg, context, config) => {
    const code = msg.url.query.code;
    const state = await context.state(OAuthState, context, config) as OAuthState;
    const key = msg.url.query.state[0];
    const userEmail = await state.getUserInfo(key);
    if (!userEmail || typeof userEmail !== 'string') {
        context.logger.error('Invalid oauth2 state parameter', ...contextLoggerArgs(context));
        return msg.setStatus(400, 'Invalid state');
    }
    const tokenUrl = config.tokenUrl
        + "?grant_type=authorization_code"
        + "&code=" + code
        + "&redirect_uri=" + encodeURIComponent(msg.url.toString())
        + "&client_id=" + config.clientId
        + "&client_secret=" + config.clientSecret;
    const tokenResponse = await context.makeRequest(msg.setUrl(tokenUrl));
    const respData = await context.verifyJsonResponse(tokenResponse);
    if (respData === 502) {
        context.logger.error('Failed to get token', ...contextLoggerArgs(context));
        return msg.setStatus(502, 'Failed to get token');
    }
    const accessToken = respData.access_token;
    const refreshToken = respData.refresh_token;
    const userMsg = msg.copy()
        .setUrl(config.userUrlPattern.replace('${email}', userEmail))
        .setMethod('PATCH')
        .setDataJson({ oauth: { [config.applicationName]: { accessToken, refreshToken } } });
    const userResp = await context.makeRequest(userMsg);
    if (!userResp.ok) {
        context.logger.error('Failed to update user', ...contextLoggerArgs(context));
        return msg.setStatus(500, 'Failed to update user');
    }
    return msg.setStatus(200, 'OK');
});

export default service;