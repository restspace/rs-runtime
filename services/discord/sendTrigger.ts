import { Message } from "rs-core/Message.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { IIntMessage, IIntResponse } from "./MessageTypes.ts";

const messageToInteractionResponse = async (msg: Message) => {
	const intResponse = {
		type: 4
	} as IIntResponse;
	let intMessage = {} as IIntMessage;
	if (!(msg.ok && msg.data)) return intResponse;
	switch (msg.data.mimeType) {
		case "text/plain": {
			intMessage.content = (await msg.data.asString()) || undefined;
			break;
		}
		case "application/json": {
			intMessage = await msg.data.asJson();
			break;
		}
	}
	intResponse.data = intMessage;
	return intResponse;
}

export const sendTrigger = async (event: string, data: any, triggerUrl: string, context: SimpleServiceContext): Promise<IIntResponse> => {
	let respMsg: Message;
	if (triggerUrl) {
		const url = triggerUrl
			.replace('${name}', data?.data?.name || '')
			.replace('${event}', event);
		context.logger.info(`Discord trigger to ${url} with data ${JSON.stringify(data)}`);
		const reqMsg = new Message(url as string, context.tenant, "GET");
		respMsg = await context.makeRequest(reqMsg);
	} else {
		respMsg = new Message('/', context.tenant, 'GET');
		respMsg.setStatus(400, "Configuration error in bot: no processor");
	}
	return await messageToInteractionResponse(respMsg);
}