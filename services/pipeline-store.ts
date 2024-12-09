import { Service } from "rs-core/Service.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { Url } from "rs-core/Url.ts";
import { pipeline } from "../pipeline/pipeline.ts";

const service = new Service();

service.all(async (msg, context) => {
	const reqForStore = msg.url.isDirectory || (msg.getHeader('X-Restspace-Request-Mode') === 'manage' && msg.method !== 'POST');
	if (reqForStore) return msg.setStatus(0); // request will be handled by store

	const getFromStore = msg.copy().setMethod('GET').setHeader("X-Restspace-Request-Mode", "manage");
	const msgPipelineSpec = await context.makeRequest(getFromStore);
	if (msg.url.isDirectory || !msgPipelineSpec.ok) return msgPipelineSpec;
	
	let pipelineSpec = await msgPipelineSpec.data!.asJson() as PipelineSpec;
	if (msg.url.query["$to-step"]) {
		const toStep = parseInt(msg.url.query["$to-step"][0]);
		if (!isNaN(toStep) && toStep < pipelineSpec.length - 1) {
			pipelineSpec = pipelineSpec.slice(0, toStep + 1);
		} 
	}

	// find the applicable url
	const pipelineUrl: Url = msg.url.copy();
	const location = msgPipelineSpec.getHeader('location');
    const locationUrl = location ? new Url(location).stripPrivateServices() : '';
	pipelineUrl.setSubpathFromUrl(locationUrl);
	
	const pipelineResult = await pipeline(msg, pipelineSpec, pipelineUrl, false, msg => context.makeRequest(msg), context.serviceName);
	return pipelineResult.setStatus(200); // stops the pipeline handling the message
})

export default service;
