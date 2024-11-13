import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { PrePost } from "rs-core/IServiceConfig.ts";
import { Message } from "rs-core/Message.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { contextLoggerArgs, ServiceContext, StateFunction } from "rs-core/ServiceContext.ts";
import { Source } from "rs-core/Source.ts";
import { Url } from "rs-core/Url.ts";
import { config } from "./config.ts";
import { handleIncomingRequest, handleOutgoingRequest } from "./handleRequest.ts";
import { pipeline } from "./pipeline/pipeline.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { getProp } from "rs-core/utility/utility.ts";

export function makeServiceContext(tenantName: string, state: StateFunction, prePost?: PrePost): ServiceContext<IAdapter> {
	const context = {
		tenant: tenantName,
		primaryDomain: config.tenants[tenantName]?.primaryDomain,
		makeRequest: (msg: Message, source?: Source) => {
			if (!msg.url.domain) msg.url.domain = config.tenants[tenantName].primaryDomain;
			return source === Source.External ? handleIncomingRequest(msg) : handleOutgoingRequest(msg, source, context)
		},
		verifyResponse: async (msg: Message, mimeType?: string) => {
			if (!msg.data) {
				context.logger.error('No data in response', ...contextLoggerArgs(context));
				return 502;
			}
			if (!msg.ok) {
				const statusText = await msg.data.asString();
				context.logger.error(`Response status ${msg.status} ${statusText}`, ...contextLoggerArgs(context));
				return 502;
			}
			if (mimeType && !msg.data.mimeType.startsWith(mimeType)) {
				context.logger.error(`Response has wrong mime type ${msg.data.mimeType}`, ...contextLoggerArgs(context));
				return 502;
			}
			return msg.data;
		},
		verifyJsonResponse: async (msg: Message, checkPath?: string) => {
			const data = await context.verifyResponse(msg, 'application/json');
			if (!(data instanceof MessageBody)) return data;
			let json: any;
			try {
				json = await data.asJson();
			} catch (err) {
				context.logger.error(`Response is not valid JSON: ${err}`, ...contextLoggerArgs(context));
				return 502;
			}
			if (checkPath) {
				const value = getProp(json, checkPath);
				if (value === undefined) {
					context.logger.error(`Path ${checkPath} not found in JSON`, ...contextLoggerArgs(context));
					return 502;
				}
			}
			return json;
		},
		runPipeline: (msg: Message, pipelineSpec: PipelineSpec, contextUrl?: Url) => {
			return pipeline(msg, pipelineSpec, contextUrl);
		},
		prePost,
		logger: config.logger,
		baseLogger: config.logger,
		getAdapter: <T extends IAdapter>(url: string, adapterConfig: unknown) => {
			const primaryDomain = config.tenants[tenantName].primaryDomain;
			return config.modules.getAdapter<T>(url, context, adapterConfig, primaryDomain);
		},
		state,
		registerAbortAction: (msg: Message, action: () => void) => {
			config.requestAbortActions.add(msg.traceId, action);
		}
	} as unknown as ServiceContext<IAdapter>;
	return context;
}