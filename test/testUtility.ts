import { Message, MessageMethod } from "../../rs-core/Message.ts";
import { Url } from "../../rs-core/Url.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { assert } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { AdapterContext } from "../../rs-core/ServiceContext.ts";
import { IAdapter } from "../../rs-core/adapter/IAdapter.ts";

export const utilsForHost = (host: string) => ({
	testMessage: (url: string, method: MessageMethod, token?: string) => {
		const msgUrl = new Url(url);
		msgUrl.scheme = "http://";
		msgUrl.domain = `${host}.restspace.local:3100`;
		const msg = new Message(msgUrl, host, method)
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
		config.requestExternal = (msg: Message) => {
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
		makeRequest: msg => msg.requestExternal(),
		runPipeline: (msg) => Promise.resolve(msg),
		logger: config.logger,
		getAdapter: getAdapter || (<T extends IAdapter>(_url: string, _config: unknown) => Promise.resolve({} as T))
	} as AdapterContext;
}

export const getAdapterFromConfig = <T extends IAdapter>(tenant: string, config: unknown, adapterConstructor: new (context: AdapterContext, config: any) => T) => {
	return new adapterConstructor(makeAdapterContext(tenant), config);
}