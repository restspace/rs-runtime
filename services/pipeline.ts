import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { IServiceConfig, ManualMimeTypes } from "rs-core/IServiceConfig.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { pipeline } from "../pipeline/pipeline.ts";
import { Source } from "rs-core/Source.ts";

interface PipelineConfig extends IServiceConfig {
    pipeline: PipelineSpec;
	manualMimeTypes?: ManualMimeTypes;
	reauthenticate?: boolean;
}

const service = new Service<IAdapter, PipelineConfig>();

service.getDirectory((msg, _context, { manualMimeTypes }) => {
	if (msg.url.query["$requestSchema"]) {
		if (!manualMimeTypes?.requestSchema) return msg.setStatus(404, "No request schema available");
		msg.setDataJson(manualMimeTypes?.requestSchema);
		msg.data!.setMimeType("application/schema+json");
		return msg;
	}
	if (msg.url.query["$responseSchema"]) {
		if (!manualMimeTypes?.responseSchema) return msg.setStatus(404, "No response schema available");
		msg.setDataJson(manualMimeTypes?.responseSchema);
		msg.data!.setMimeType("application/schema+json");
		return msg;
	}
	let pattern = "transform";
	if (manualMimeTypes) {
		let isSend = true;
		if (manualMimeTypes.requestMimeType === "none" || manualMimeTypes.requestSchema?.type === "null") {
			isSend = false;
		}
		let isReceive = true;
		if (manualMimeTypes.responseMimeType === "none" || manualMimeTypes.responseSchema?.type === "null") {
			isReceive = false;
		}
		if (!isReceive && isSend) pattern = "operation";
		else if (isReceive && !isSend) pattern = "view";
	}

	msg.setDirectoryJson({
		path: '/',
		paths: [],
		spec: {
			pattern,
			reqMimeType: manualMimeTypes?.requestSchema
				? `application/json;schema=${msg.url.baseUrl()}/?$requestSchema`
				: manualMimeTypes?.requestMimeType,
			respMimeType: manualMimeTypes?.responseSchema
				? `application/json;schema=${msg.url.baseUrl()}/?$responseSchema`
				: manualMimeTypes?.responseMimeType
		}
	});
	return msg;
});

service.all((msg, context, config) => {
	let runPipeline = config.pipeline;
	if (msg.url.query["$to-step"]) {
		const toStep = parseInt(msg.url.query["$to-step"][0]);
		if (!isNaN(toStep) && toStep < config.pipeline.length - 1) {
			runPipeline = config.pipeline.slice(0, toStep + 1);
		} 
	}
	return pipeline(msg, runPipeline, msg.url, false, msg => context.makeRequest(msg, config.reauthenticate ? Source.Outer : Source.Internal));
})

export default service;

