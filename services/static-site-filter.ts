import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { Url } from "rs-core/Url.ts";
import { ServiceContext } from "../../rs-core/ServiceContext.ts";

interface IStaticSiteFilterConfig extends IServiceConfig {
    divertMissingToDefault?: boolean;
	defaultResource?: string;
}

const service = new Service<IFileAdapter, IStaticSiteFilterConfig>();

const processGet = async (msg: Message, { adapter, logger }: ServiceContext<IFileAdapter>, config: IStaticSiteFilterConfig) => {
	const targetPath = msg.url.servicePath || '/';
	const details = await adapter.check(targetPath!);
	if (details.status === "directory") {
		const url = new Url(msg.url.query["outerUrl"][0] || '');
		url.path += '/';
		return msg.redirect(url);
	}
	if (config.divertMissingToDefault && config.defaultResource && details.status === 'none') {
		msg.setServiceRedirect(config.defaultResource);
		logger.debug(`static-site-filter diverting ${msg.url} to ${config.defaultResource}`);
	}
	return msg;
}

service.get(processGet);

service.getDirectory(async (msg, context, config) => {
	if (config.defaultResource && !msg.isManageRequest) {
		msg.url.resourceName = config.defaultResource;
		const msgOut = await processGet(msg, context, config);
		msgOut.setServiceRedirect(msgOut.url.servicePath);
		return msgOut;
	} else {
		return msg;
	}
});

export default service;