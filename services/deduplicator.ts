import { Service } from "rs-core/Service.ts";
import { BaseStateClass } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";

const service = new Service();

export interface DedupSpec {
	increasingProperty?: string;
	uniqueProperty?: string;
}

export class ArrivedState extends BaseStateClass {
	arrived: Record<string, Set<string>> = {};
	latestValue: Record<string, number | Date | string> = {};

	checkArrived(storePath: string, key: string) {
		const hadArrived = this.arrived[storePath].has(key);
		if (!hadArrived) this.arrived[storePath].add(key);
		return hadArrived;
	}

	checkLatest(storePath: string, value: number | Date | string) {
		const latest = this.latestValue[storePath];
		if (latest && latest >= value) return false;
		this.latestValue[storePath] = value;
		return true;
	}
}

const recordIsDuplicate = (data: Record<string, unknown>, dedupSpec: DedupSpec, arrivedState: ArrivedState, specUrl: Url) => {
	const subPath = specUrl.subPathElements.join('/');
	if (dedupSpec.uniqueProperty) {
		const uniqueValue = (data[dedupSpec.uniqueProperty] as any).toString();
		return arrivedState.checkArrived(subPath, uniqueValue);
	} else if (dedupSpec.increasingProperty) {
		const increasingValue = data[dedupSpec.increasingProperty] as number | Date | string;
		return !arrivedState.checkLatest(subPath, increasingValue);
	}
}

service.all(async (msg, context) => {
	const reqForStore = msg.url.isDirectory || (msg.getHeader('X-Restspace-Request-Mode') === 'manage' && msg.method !== 'POST');
	if (reqForStore) return msg; // request will be handled by store

	const getFromStore = msg.copy().setMethod('GET').setHeader("X-Restspace-Request-Mode", "manage");
	const msgDedupSpec = await context.makeRequest(getFromStore);
	if (msg.url.isDirectory || !msgDedupSpec.ok) return msgDedupSpec;
	
	const dedupSpec = await msgDedupSpec.data!.asJson() as DedupSpec;
	const specUrl: Url = msg.url.copy();
	specUrl.setSubpathFromUrl(msgDedupSpec.getHeader('location') || '');

	const arrivedState = await context.state(ArrivedState, context, dedupSpec);
	const data = await msg.data?.asJson() as Record<string, unknown> | Record<string, unknown>[];
	if (Array.isArray(data)) {
		return msg.setDataJson(data.filter(d => !recordIsDuplicate(d, dedupSpec, arrivedState, specUrl)));
	} else {
		if (recordIsDuplicate(data, dedupSpec, arrivedState, specUrl)) {
			return msg.setStatus(409, 'Duplicate record');
		} else {
			return msg;
		}
	}
})

export default service;
