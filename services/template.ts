import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ITemplateAdapter } from "rs-core/adapter/ITemplateAdapter.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";

interface ITemplateConfig extends IServiceConfig {
	outputMime: string;
	metadataProperty?: string;
}

const service = new Service<ITemplateAdapter, ITemplateConfig>();

service.post(async (msg: Message, context: ServiceContext<ITemplateAdapter>, config: ITemplateConfig) => {
	const data: Record<string, unknown> = (await msg.data?.asJson()) ?? {};
	if (config.metadataProperty) {
		data[config.metadataProperty] = {
			headers: Object.fromEntries(Object.entries(msg.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
			schema: msg.schema,
			method: msg.method
		}
	}
	const reqTemplate = msg.copy().setMethod("GET");
	const msgTemplate = await context.makeRequest(reqTemplate);
	if (!msgTemplate.ok) return msgTemplate;
	const template = await msgTemplate.data!.asString();

	// find the applicable url
	const contextUrl: Url = msg.url.copy();
	const location = msgTemplate.getHeader('location');
    const locationUrl = location ? new Url(location).stripPrivateServices() : '';
	contextUrl.setSubpathFromUrl(locationUrl);

	const output = await context.adapter.fillTemplate(data, template || "", contextUrl);
	return msg.setData(output, config.outputMime);
});

export default service;