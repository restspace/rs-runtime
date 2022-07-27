import { Service } from "rs-core/Service.ts";
import { pipeline } from "../pipeline/pipeline.ts";

const service = new Service();

service.all(async (msg, context) => {
	const reqForStore = msg.getHeader('X-Restspace-Request-Mode') === 'manage' && msg.method !== 'POST';
	if (reqForStore) return msg; // request will be handled by store

	const getFromStore = msg.copy().setMethod('GET').setHeader("X-Restspace-Request-Mode", "manage");
	const msgPipelineSpec = await context.makeRequest(getFromStore);
	if (!msgPipelineSpec.ok) return msgPipelineSpec;
	const pipelineSpec = await msgPipelineSpec.data!.asJson();
	return pipeline(msg, pipelineSpec, msg.url, false, msg => context.makeRequest(msg));
})

export default service;

