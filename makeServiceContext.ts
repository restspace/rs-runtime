import { IAdapter } from "../rs-core/adapter/IAdapter.ts";
import { PrePost } from "../rs-core/IServiceConfig.ts";
import { Message } from "../rs-core/Message.ts";
import { PipelineSpec } from "../rs-core/PipelineSpec.ts";
import { IStateClass, ServiceContext, SimpleServiceContext, StateClass } from "../rs-core/ServiceContext.ts";
import { Url } from "../rs-core/Url.ts";
import { config } from "./config.ts";
import { handleOutgoingRequest } from "./handleRequest.ts";
import { pipeline } from "./pipeline/pipeline.ts";
import { StateFunction } from "./tenant.ts";

export function makeServiceContext(tenantName: string, state?: StateFunction, prePost?: PrePost): ServiceContext<IAdapter> {
	const context = {
		tenant: tenantName,
		makeRequest: handleOutgoingRequest,
		runPipeline: (msg: Message, pipelineSpec: PipelineSpec, contextUrl?: Url) => {
			pipeline(msg, pipelineSpec, contextUrl);
		},
		prePost,
		logger: config.logger,
		getAdapter: <T extends IAdapter>(url: string, adapterConfig: unknown) => {
			return config.modules.getAdapter<T>(url, context, adapterConfig)
		},
		state
	} as ServiceContext<IAdapter>;
	return context;
}