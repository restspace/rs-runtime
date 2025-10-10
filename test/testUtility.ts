import { Message, MessageMethod } from "rs-core/Message.ts";
import { Url } from "rs-core/Url.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { assert } from "std/testing/asserts.ts";
import { config as sysConfig } from "../config.ts";
import { AdapterContext, nullState } from "rs-core/ServiceContext.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";

export const utilsForHost = (host: string) => ({
	testMessage: (url: string, method: MessageMethod, token?: string) => {
		const msgUrl = new Url(url);
		msgUrl.scheme = "http://";
		msgUrl.domain = `${host}.restspace.local:3100`;
		const msg = new Message(msgUrl, host, method, null)
			.setHeader('host', msgUrl.domain);
		if (token) msg.cookies['rs-auth'] = token;
		return msg;
	},

	writeJson: async (url: string, value: any, errorMsg?: string, token?: string) => {
		const msg = utilsForHost(host).testMessage(url, "PUT").setDataJson(value);
		if (token) msg.cookies['rs-auth'] = token;
		const msgOut: Message = await handleIncomingRequest(msg);
		assert(msgOut.ok, errorMsg);
		return msgOut;
	},

	setDomainHandler: (domain: string, func: (msg: Message) => void) => {
		sysConfig.requestExternal = (msg: Message) => {
			if (msg.url.domain === domain) {
				func(msg);
				return Promise.resolve(msg.setStatus(200));
			} else {
				return msg.requestExternal();
			}
		};
	}
});

export const makeAdapterContext = (tenant: string, getAdapter?: <T extends IAdapter>(url: string, config: unknown) => Promise<T>) => {
	return {
		tenant,
		primaryDomain: sysConfig.tenants?.[tenant]?.primaryDomain || 'nodomain',
		registerAbortAction: (msg: Message, action: () => void) => {
			sysConfig.requestAbortActions.add(msg.traceId, action);
		},
		makeRequest: msg => msg.requestExternal(),
		runPipeline: (msg) => Promise.resolve(msg),
		logger: sysConfig.logger,
		baseLogger: sysConfig.logger,
		verifyResponse: async (msg: Message, mimeType?: string) => {
			if (!msg.data) {
				sysConfig.logger.error('No data in response');
				return 502;
			}
			if (!msg.ok) {
				const statusText = await msg.data.asString();
				sysConfig.logger.error(`Response status ${msg.status} ${statusText}`);
				return 502;
			}
			if (mimeType && !msg.data.mimeType.startsWith(mimeType)) {
				sysConfig.logger.error(`Response has wrong mime type ${msg.data.mimeType}`);
				return 502;
			}
			return msg.data;
		},
		verifyJsonResponse: async (msg: Message, checkPath?: string) => {
			const data = await (async () => await (async () => {
				if (!msg.data) return 502;
				if (!msg.ok) return 502;
				return msg.data;
			})())();
			if (!(data instanceof MessageBody)) return 502;
			let json: any;
			try {
				json = await data.asJson();
			} catch (err) {
				sysConfig.logger.error(`Response is not valid JSON: ${err}`);
				return 502;
			}
			if (checkPath) {
				const value = (json as any)?.[checkPath as keyof typeof json];
				if (value === undefined) return 502;
			}
			return json;
		},
		getAdapter: getAdapter || (<T extends IAdapter>(_url: string, _config: unknown) => Promise.resolve({} as T)),
		state: nullState
	} as AdapterContext;
}

export const getAdapterFromConfig = <T extends IAdapter>(tenant: string, config: unknown, adapterConstructor: new (context: AdapterContext, config: any) => T) => {
	return new adapterConstructor(makeAdapterContext(tenant), config);
}