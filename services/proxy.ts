import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { ServiceContext } from "../../rs-core/ServiceContext.ts";

const service = new Service<IProxyAdapter>();

service.all(async (msg: Message, { adapter, makeRequest }: ServiceContext<IProxyAdapter>) => {
	const sendMsg = await adapter.buildMessage(msg);
	return makeRequest(sendMsg);
});

export default service;