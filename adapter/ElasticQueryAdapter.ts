import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";

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

	async runQuery(query: string): Promise<number | Record<string,unknown>[]> {
		await this.ensureProxyAdapter();
		const msg = new Message('/_search', this.context.tenant, "POST");
		msg.setData(query, "application/json");
		const res = await this.requestElastic(msg);
		if (!res.ok) {
			const report = await res.data?.asString();
			throw new Error(`Elastic adapter error, query: ${report}`);
		}
		const data = await res.data?.asJson();
		return data.hits.hits;
	}
	
	quoteString(s: string): string {
		return '"' + s.replace('"', '\\"') + '"';
	}
}