import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { Url } from "rs-core/Url.ts";
import { BaseStateClass } from "rs-core/ServiceContext.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { Source } from "rs-core/Source.ts";

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
		if (!(msg.user && new AuthUser(msg.user).authorizedFor(config.acquiredRole))) {
			return msg.setStatus(401, "Unauthorized");
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
		if (!msg.url.toString().startsWith(baseUrl)) {
			return msg.setStatus(403, "Attempt to access a url outside the base url for which this token is valid"); 
		}
		msg.user = new AuthUser(msg.user || AuthUser.anon).addRole(config.acquiredRole);
		return context.makeRequest(msg, Source.External); // requested service will check user's authorization
	} else if (msg.method === 'GET') {
		// get a new token authorised for the subpath after the token
		if (!(msg.user && new AuthUser(msg.user).authorizedFor(config.acquiredRole))) {
			return msg.setStatus(401, "Cannot generate a temporary access token with an acquired role for which the user is not authorized");
		}
		const newToken: string = crypto.randomUUID();
		const now = new Date();
		const expiry = new Date().setTime(now.getTime() + 1000 * config.expirySecs);
		state.validTokenExpiries.push([ new Date(expiry), newToken ]);
		state.tokenBaseUrls[newToken] = '/' + msg.url.servicePath;
		return msg.setText(newToken);
	} else {
		return msg.setStatus(404, "Not found");
	}
});

export default service;