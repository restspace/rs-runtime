import { AdapterContext } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { gql, request } from "https://deno.land/x/graphql_request@v3.7.1/mod.ts";


export interface ElasticAdapterProps {
	endpointUrl: string;
}

export default class ElasticQueryAdapter implements IQueryAdapter {
	
	constructor(public context: AdapterContext, public props: ElasticAdapterProps) {
    }

	async runQuery(query: string, variables: Record<string, unknown>, _take = 1000, _skip = 0): Promise<number | Record<string,unknown>[]> {
		try {
			const data = await request(this.props.endpointUrl, query, variables);
			return data;
		} catch (err) {
			this.context.logger.error(`GraphQL query failed: ${err}`);
			return 500;
		}
	}
}