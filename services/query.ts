import { Service } from "rs-core/Service.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";
import { getProp } from "../../rs-core/utility/utility.ts";

const service = new Service<IQueryAdapter>();


const quoteStrings = (obj: any, adapter: IQueryAdapter): any => {
	if (typeof obj === 'string') {
		return adapter.quoteString(obj);
	} else if (Array.isArray(obj)) {
		return obj.map(item => quoteStrings(item, adapter));
	} else if (typeof obj === 'object') {
		return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, quoteStrings(v, adapter)]));
	} else {
		return obj;
	}
}

service.post(async (msg: Message, context: ServiceContext<IQueryAdapter>) => {
	let params = (await msg.data?.asJson()) ?? {};
	const reqQuery = msg.copy().setMethod("GET");
	const msgQuery = await context.makeRequest(reqQuery);
	if (!msgQuery.ok) return msgQuery;
	let query = await msgQuery.data!.asString();
	if (!query) return msg.setStatus(400, 'No query');

	// find the applicable url
	const contextUrl: Url = msg.url.copy();
	contextUrl.setSubpathFromUrl(msgQuery.getHeader('location') || '');
	params = quoteStrings(params, context.adapter);

	query = query.replace(/\$\{([^}]*)\}/gi, (_, p1) => getProp(params, p1.split('.')) || '');
	query = query.replace(/\$([0-9]+)/gi, (_, p1) => {
		const idx = parseInt(p1);
		return idx < (contextUrl.subPathElementCount || 0) 
			? context.adapter.quoteString(contextUrl.subPathElements[idx])
			: '';
	});

	const result = await context.adapter.runQuery(query);
	if (typeof result === 'number') return msg.setStatus(result);
	msg.setDataJson(result);
	return msg;
});

export default service;
