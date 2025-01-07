import { Service } from "rs-core/Service.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";
import { getProp } from "rs-core/utility/utility.ts";

const service = new Service<IQueryAdapter>();

service.postIsWrite = false;
service.post(async (msg: Message, context: ServiceContext<IQueryAdapter>) => {
	let params = (await msg.data?.asJson()) ?? {};
	if (typeof params !== 'object') params = {};
	const reqQuery = msg.copy().setMethod("GET");
	const msgQuery = await context.makeRequest(reqQuery);
	if (!msgQuery.ok) return msgQuery;
	let query = await msgQuery.data!.asString();
	if (!query) return msg.setStatus(400, 'No query');

	// find the applicable url: the msgQuery location header tells you the url of the actual query file
	// - the rest is the subpath of the url
	const contextUrl: Url = msg.url.copy();
	const location = msgQuery.getHeader('location');
    const locationUrl = location ? new Url(location).stripPrivateServices() : '';
	contextUrl.setSubpathFromUrl(locationUrl);

	let error = null as Error | null;

	const quote = context.adapter.quote;
	if (quote) {
		query = query.replace(/\$\{([^}]*)\}/gi, (_, p1) => {
			const val = p1 === ''
				? params
				: (getProp(params, p1.split('.')) ?? '');
			const quoted = quote(val);
			if (quoted instanceof Error) {
				error = quoted;
				return '';
			} else {
				return quoted;
			}
		});
		if (error === null) {
			query = query.replace(/\$([0-9]+)/gi, (_, p1) => {
				const idx = parseInt(p1);
				if (idx < (contextUrl.subPathElementCount || 0)) {
					const quoted = quote(contextUrl.subPathElements[idx]);
					if (quoted instanceof Error) {
						error = quoted;
						return '';
					} else {
						return quoted;
					}
				} else {
					return '';
				}
			});
		}
		if (error !== null) return msg.setStatus(400, error.toString());
	}

	context.logger.info(`Query: ${query}`);
	for (let i=0; i < (contextUrl.subPathElementCount || 0); i++) {
		params['p' + i.toString()] = contextUrl.subPathElements[i];
	}
	const result = await context.adapter.runQuery(query, params);
	if (typeof result === 'number') return msg.setStatus(result);
	msg.setDataJson(result);
	return msg;
});

export default service;
