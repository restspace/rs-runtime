import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ITemplateAdapter } from "rs-core/adapter/ITemplateAdapter.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";

interface IJsonSchemaFormConfig extends IServiceConfig {
}

const service = new Service<ITemplateAdapter, IJsonSchemaFormConfig>();

const jsonSchemaToHtml = (schema: any, data: any) => {
	return "";
};


service.post(async (msg: Message, context: ServiceContext<ITemplateAdapter>, config: IJsonSchemaFormConfig) => {
	const data = await msg.data?.asJson();
	if (!msg.data || !data) return msg.setStatus(400, "No data provided");
	let html = '';
	if (msg.data.mimeType === "application/schema+json") {
		html = jsonSchemaToHtml(data, null);
	} else if (msg.data.mimeType.startsWith("application/json; schema=")) {
		const schemaUrlStr = msg.data.mimeType.split('"')[1];
		let schemaUrl = null as Url | null;
		try {
			schemaUrl = new Url(schemaUrlStr);
		} catch {
			return msg.setStatus(400, "Invalid schema url");
		}
		const schemaMsg = msg.copy().setUrl(schemaUrl).setMethod("GET");
		const schemaDataMsg = await context.makeRequest(schemaMsg);
		if (!schemaDataMsg.ok) return schemaDataMsg;
		const schema = await schemaDataMsg.data?.asJson();
		if (!schema) return schemaDataMsg.setStatus(400, "No schema data on mime type schema url");
		html = jsonSchemaToHtml(schema, data);
	}
	return msg.setData(html, "text/html");
});

export default service;