import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { Url } from "rs-core/Url.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

interface IStaticSiteFilterConfig extends IServiceConfig {
    divertMissingToDefault?: boolean;
	//defaultResource?: string;
}

const service = new Service<IFileAdapter, IStaticSiteFilterConfig>();

const processGet = async (msg: Message, { adapter, logger }: ServiceContext<IFileAdapter>, config: IStaticSiteFilterConfig) => {
	const targetPath = msg.url.servicePath || '/';
	const details = await adapter.check(targetPath!);
	if (config.divertMissingToDefault && details.status === 'none' && !msg.isManageRequest) {
		msg.setServiceRedirect('/');
		logger.debug(`static-site-filter diverting ${msg.url} to default`);
	}
	return msg;
}

service.get(processGet);

// service.getDirectory(async (msg, context, config) => {
// 	if (config.defaultResource && !msg.isManageRequest) { // get the default resource for the directory
// 		msg.url.resourceName = config.defaultResource;
// 		const msgOut = await processGet(msg, context, config);
// 		msgOut.setServiceRedirect(msgOut.url.servicePath);
// 		return msgOut;
// 	} else {
// 		if (config.divertMissingToDefault && config.defaultResource) { // divert to the SPA
// 			msg.setServiceRedirect(config.defaultResource);
// 			context.logger.debug(`static-site-filter diverting ${msg.url} to ${config.defaultResource}`);
// 		} 
// 		return msg;
// 	}
// });

export default service;