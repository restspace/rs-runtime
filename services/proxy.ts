import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";

interface IProxyConfig extends IServiceConfig {
    corsAllowedHeaders?: string[];
}

const service = new Service<IProxyAdapter>();

service.all(async (msg: Message, context: ServiceContext<IProxyAdapter>) => {
	const { adapter, makeRequest } = context;
	let sendMsg = msg.copy();
	// remove the base path from the url
	while (sendMsg.url.basePathElementCount > 0) {
		sendMsg.url.pathElements.shift();
		sendMsg.url.basePathElementCount--;
	}
	sendMsg = await adapter.buildMessage(sendMsg);
	context.logger.info(`Proxy, msg headers: ${JSON.stringify(sendMsg.headers)}`);
	const msgOut = await makeRequest(sendMsg);
	msgOut.url = msg.url;
	return msgOut;
});

service.options((msg: Message, context: ServiceContext<IProxyAdapter>, config: IProxyConfig) => {
	const { corsAllowedHeaders } = config;
	let headers = msg.getHeader('Access-Control-Request-Headers') || '';
	headers = headers.toLowerCase();
	context.logger.info(`Access-Control-Request-Headers: ${headers} corsAllowedHeaders: ${corsAllowedHeaders?.join(',') || 'none'}`);
	const allowedHeaders = corsAllowedHeaders?.length ? corsAllowedHeaders.filter(h => headers === '' || headers.includes(h.toLowerCase())) : [];
	msg.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(','));
	return Promise.resolve(msg);
});

export default service;