import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { Url } from "rs-core/Url.ts";
import { BaseStateClass } from "rs-core/ServiceContext.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { Source } from "rs-core/Source.ts";
import { _121665 } from "https://cdn.jsdelivr.net/gh/intob/tweetnacl-deno@1.1.0/src/core.ts";

interface ITemporaryAccessConfig extends IServiceConfig {
	acquiredRole: string;
	expirySecs: number;
}

class TemporaryAccessState extends BaseStateClass {
	validTokenExpiries: [ Date, string ][] = [];
	tokenBaseUrls: Record<string, string> = {};
}

const service = new Service<IFileAdapter, ITemporaryAccessConfig>();

service.all(async (msg, context, config) => {
	const state = await context.state(TemporaryAccessState, context, config);

	const expireTokens = () => {
		const now = new Date();
		while (state.validTokenExpiries.length > 0 && state.validTokenExpiries[0][0] < now) {
			delete state.tokenBaseUrls[state.validTokenExpiries[0][1]];
			state.validTokenExpiries.shift();
		}
	}

	const key = msg.url.servicePathElements[0] || '';
	expireTokens();
	const baseUrl = key && state.tokenBaseUrls[key];
	if (baseUrl
		&& msg.url.servicePathElements.length === 1
		&& !msg.url.isDirectory) {
		// request /basePath/<token> to operate on token record
		if (msg.method === 'GET') {
			const tokenBaseUrl = state.tokenBaseUrls[key];
			if (!tokenBaseUrl) {
				return msg.setStatus(404, "Token expired or invalid");
			};
			const retVal = {
				baseUrl: tokenBaseUrl,
				expiry: state.validTokenExpiries.find(([_, token]) => token === key)?.[0].toISOString(),
			};
			return msg.setDataJson(retVal);
		}

		if (!(msg.user && new AuthUser(msg.user).authorizedFor(config.acquiredRole))) {
			return msg.setStatus(403, "User does not have acquired role of token requested");
		}
		if (msg.method === 'DELETE') {
			delete state.tokenBaseUrls[key];
			state.validTokenExpiries = state.validTokenExpiries.filter(([_, token]) => token !== key);
			return msg.setStatus(204);
		}
		return msg.setStatus(405, "Method not allowed");
	} else if (baseUrl) {
		// forward to path after token
		msg.url = new Url('/' + msg.url.servicePathElements.slice(1).join('/'));
		if (!decodeURI(msg.url.toString()).startsWith(baseUrl)) {
			return msg.setStatus(403, "Attempt to access a url outside the base url for which this token is valid"); 
		}
		msg.user = new AuthUser(msg.user || AuthUser.anon).addRole(config.acquiredRole);
		return context.makeRequest(msg, Source.External); // requested service will check user's authorization
	} else if (msg.method === 'POST' && msg.url.servicePathElements.length <= 1 && msg.url.query['path']) {
		// get a new token authorised for the subpath in the fragment
		if (!(msg.user && new AuthUser(msg.user).authorizedFor(config.acquiredRole))) {
			return msg.setStatus(401, "Cannot generate a temporary access token with an acquired role for which the user is not authorized");
		}
		const newToken: string = msg.url.servicePathElements.length === 1
			? msg.url.servicePathElements[0]
			: crypto.randomUUID();
		// check newToken is valid guid
		if (!newToken.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
			return msg.setStatus(400, "Token must be a valid guid");
		}
		const now = new Date();
		const expiry = new Date().setTime(now.getTime() + 1000 * config.expirySecs);
		state.validTokenExpiries.push([ new Date(expiry), newToken ]);
		state.tokenBaseUrls[newToken] = decodeURI(msg.url.query.path[0]);
		if (!state.tokenBaseUrls[newToken].startsWith('/')) {
			state.tokenBaseUrls[newToken] = '/' + state.tokenBaseUrls[newToken];
		}
		return msg.setText(newToken);
	} else {
		if (msg.url.servicePathElements.length === 1) {
			return msg.setStatus(404, "Not found");
		} else {
			return msg.setStatus(401, "Token not valid");
		}
	}
});

export default service;