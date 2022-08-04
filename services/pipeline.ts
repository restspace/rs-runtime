import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { pipeline } from "../pipeline/pipeline.ts";

interface ManualMimeTypes {
	requestMimeType: string;
	requestSchema: Record<string, unknown>;
	responseMimeType: string;
	responseSchema: Record<string, unknown>;
}

interface PipelineConfig extends IServiceConfig {
    pipeline: PipelineSpec;
	manualMimeTypes: ManualMimeTypes;
}

const service = new Service<IAdapter, PipelineConfig>();

service.all((msg, context, config) => {
	let runPipeline = config.pipeline;
	if (msg.url.query["$to-step"]) {
		const toStep = parseInt(msg.url.query["$to-step"][0]);
		if (!isNaN(toStep) && toStep < config.pipeline.length - 1) {
			runPipeline = config.pipeline.slice(0, toStep + 1);
		} 
	}
	return pipeline(msg, runPipeline, msg.url, false, msg => context.makeRequest(msg));
})

export default service;

