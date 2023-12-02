import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ISmsAdapter } from "rs-core/adapter/ISmsAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

const service = new Service<ISmsAdapter>();

service.post(async (msg: Message, context: ServiceContext<ISmsAdapter>) => {
	const phoneNumber = msg.url.servicePathElements[0];
	const message = await msg.data?.asString();
	if (!message) return msg.setStatus(400, 'No message');
	const status = await context.adapter.send(phoneNumber, message);
	return msg.setStatus(status);
});

export default service;