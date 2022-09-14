import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ITemplateAdapter } from "rs-core/adapter/ITemplateAdapter.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

interface ITemplateConfig extends IServiceConfig {
	outputMime: string;
}

const service = new Service<ITemplateAdapter, ITemplateConfig>();

service.post(async (msg: Message, context: ServiceContext<ITemplateAdapter>, config: ITemplateConfig) => {
	const data = (await msg.data?.asJson()) ?? {};
	const reqTemplate = msg.copy().setMethod("GET");
	const msgTemplate = await context.makeRequest(reqTemplate);
	if (!msgTemplate.ok) return msgTemplate;
	const template = await msgTemplate.data!.asString();
	const output = await context.adapter.fillTemplate(data, template || "", msg.url);
	return msg.setData(output, config.outputMime);
});

export default service;