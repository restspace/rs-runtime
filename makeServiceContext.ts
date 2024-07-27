import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { PrePost } from "rs-core/IServiceConfig.ts";
import { Message } from "rs-core/Message.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { ServiceContext, StateFunction } from "rs-core/ServiceContext.ts";
import { Source } from "rs-core/Source.ts";
import { Url } from "rs-core/Url.ts";
import { config } from "./config.ts";
import { handleIncomingRequest, handleOutgoingRequest } from "./handleRequest.ts";
import { pipeline } from "./pipeline/pipeline.ts";

export function makeServiceContext(tenantName: string, state: StateFunction, prePost?: PrePost): ServiceContext<IAdapter> {
	const context = {
		tenant: tenantName,
		primaryDomain: config.tenants[tenantName]?.primaryDomain,
		makeRequest: (msg: Message, source?: Source) => {
			if (!msg.url.domain) msg.url.domain = config.tenants[tenantName].primaryDomain;
			return source === Source.External ? handleIncomingRequest(msg) : handleOutgoingRequest(msg, source)
		},
		runPipeline: (msg: Message, pipelineSpec: PipelineSpec, contextUrl?: Url) => {
			pipeline(msg, pipelineSpec, contextUrl);
		},
		prePost,
		logger: config.logger,
		getAdapter: <T extends IAdapter>(url: string, adapterConfig: unknown) => {
			const primaryDomain = config.tenants[tenantName].primaryDomain;
			return config.modules.getAdapter<T>(url, context, adapterConfig, primaryDomain);
		},
		state,
		registerAbortAction: (msg: Message, action: () => void) => {
			config.requestAbortActions.add(msg.traceId, action);
		}
	} as ServiceContext<IAdapter>;
	return context;
}