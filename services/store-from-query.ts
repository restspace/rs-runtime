import { Service } from "rs-core/Service.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";

interface StoreFromQueryConfig extends IServiceConfig {
    itemQuery: string;
	listQuery: string;
	underlyingStoreUrlPattern: string;
}

const service = new Service<IQueryAdapter, StoreFromQueryConfig>();

const getQueryResult = (queryProp: string) => async (msg: Message, context: ServiceContext<IQueryAdapter>, config: StoreFromQueryConfig) => {
	let query = (config as any)[queryProp] as string;

	const quote = context.adapter.quote;
	if (quote) {
		query = query.replace(/\$([0-9]+)/gi, (_, p1) => {
			const idx = parseInt(p1);
			if (idx < (msg.url.servicePathElements.length || 0)) {
				const quoted = quote(msg.url.servicePathElements[idx]);
				if (quoted instanceof Error) {
					return '';
				} else {
					return quoted;
				}
			} else {
				return '';
			}
		});
	}

	context.logger.info(`Query: ${query}`);
	const params: Record<string, unknown> = {};
	for (let i=0; i < (msg.url.servicePathElements.length || 0); i++) {
		params['p' + i.toString()] = msg.url.servicePathElements[i];
	}
	const result = await context.adapter.runQuery(query, params);
	if (typeof result === 'number') return msg.setStatus(result);
	const items = Array.isArray(result)
		? result
		: (result && typeof result === 'object' && Array.isArray((result as any).items))
			? (result as any).items as Record<string, unknown>[]
			: null;
	if (!items) return msg.setStatus(500, 'Invalid query result');
	if (items.length === 0) return msg.setStatus(404, 'No result');
	msg.setDataJson(items[0]);
	return msg;
}

const saveToUnderlyingStore = (method: MessageMethod) => async (msg: Message, context: ServiceContext<IQueryAdapter>, config: StoreFromQueryConfig) => {
	const result = await getQueryResult('itemQuery')(msg, context, config);
	if (!result.ok) return result;
	const data = await msg.data?.asJson();
	if (!data && method !== 'DELETE') return msg.setStatus(400, 'No data');
	const storeUrl = resolvePathPatternWithUrl(config.underlyingStoreUrlPattern, msg.url, data);
	if (Array.isArray(storeUrl)) {
		return msg.setStatus(400, 'Underlying store URL pattern must not contain any path segments');
	}
	const storeMsg = msg.copy().setUrl(storeUrl).setMethod(method);
	if (data) storeMsg.setDataJson(data);
	return context.makeRequest(storeMsg);
}

service.get(getQueryResult('itemQuery'));

service.put(saveToUnderlyingStore('PUT'));
service.post(saveToUnderlyingStore('POST'));

service.delete(saveToUnderlyingStore('DELETE'));

service.getDirectory(getQueryResult('listQuery'));

export default service;
