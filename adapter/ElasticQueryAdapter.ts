import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext, contextLoggerArgs } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { upTo } from "rs-core/utility/utility.ts";

export interface ElasticAdapterProps {
	username: string;
	password: string;
	host: string;
}

export default class ElasticQueryAdapter implements IQueryAdapter {
	elasticProxyAdapter: IProxyAdapter | null = null;
	
	constructor(public context: AdapterContext, public props: ElasticAdapterProps) {
    }

	async ensureProxyAdapter() {
		if (this.elasticProxyAdapter === null) {
			this.elasticProxyAdapter = await this.context.getAdapter<IProxyAdapter>("./adapter/ElasticProxyAdapter.ts", {
				username: this.props.username,
				password: this.props.password,
				host: this.props.host
			});
		}
	}

	async requestElastic(msg: Message) {
		await this.ensureProxyAdapter();
		const sendMsg = await this.elasticProxyAdapter!.buildMessage(msg);
		return await this.context.makeRequest(sendMsg);
	}

	async runQuery(query: string, _: Record<string, unknown>, take = 1000, skip = 0): Promise<number | Record<string,unknown>[]> {
		await this.ensureProxyAdapter();
		let index = '';
		let operation = '_search';
		let paged = true;
		
		let queryObj = {} as any;
		try {
			queryObj = JSON.parse(query);
		} catch (e) {
			this.context.logger.error(`Invalid JSON (${e}) in ES query: ${query}`, ...contextLoggerArgs(this.context));
			return 400;
		}
		if (queryObj.index) {
			index = '/' + queryObj.index;
			delete queryObj.index;
		}
		if (queryObj.operation) {
			operation = queryObj.operation;
			delete queryObj.operation;
			const opName = upTo(operation, '?');
			if ([ "_update_by_query", "_delete_by_query", "_count" ].includes(opName)) {
				paged = false;
			} else if (![ "_search" ].includes(opName)) {
				this.context.logger.error(`Unknown operation in ES query: ${operation}`, ...contextLoggerArgs(this.context));
				return 400;
			}
		}
		if (paged) {
			if (queryObj.size === undefined) queryObj.size = take;
			if (queryObj.from === undefined) queryObj.from = skip;
		}

		const msg = new Message(`${index}/${operation}`, this.context.tenant, "POST", null);
		msg.startSpan(this.context.traceparent, this.context.tracestate);
		msg.setDataJson(queryObj);
		const res = await this.requestElastic(msg);
		if (!res.ok) {
			const report = await res.data?.asString();
			throw new Error(`Elastic adapter error, query: ${report}`);
		}
		const data = await res.data?.asJson();
		switch (operation) {
			case "_search": return data.hits.hits;
			default: return data;
		}
	}
	
	quote(x: any): string | Error {
		if (typeof x === "string") {
			return "\"" + x.replace(/\"/g, "\\\"") + "\"";
		} else if (typeof x !== "object") {
			return JSON.stringify(x);
		} else if (Array.isArray(x)) {
			return JSON.stringify(x
				.filter(item => typeof item !== "object")
			);
		} else {
			return new Error('query variable must be a primitive, or an array of primitives');
		}
	}
}