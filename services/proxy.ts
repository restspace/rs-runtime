import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

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
	return makeRequest(sendMsg);
});

export default service;