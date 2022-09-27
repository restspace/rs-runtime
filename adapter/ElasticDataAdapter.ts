import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";
import { ItemMetadata, ItemNone } from "rs-core/ItemMetadata.ts";
import { Message } from "rs-core/Message.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface ElasticAdapterProps {
	username: string;
	password: string;
	domainAndPort: string;
}

export const schemaToMapping = (schema: any): any => {
	switch (schema.type as string) {
		case "string":
			return schema.search === 'textual' ? { type: "text" }
				: ['date', 'date-time'].includes(schema.format || 'zzz') ? { type: "date" }
				: { type: "keyword" };
		case "number":
			return { type: "double" };
		case "boolean":
			return { type: "boolean" };
		case "object":
			return {
				properties: Object.fromEntries(
					Object.entries(schema.properties)
						.map(([k, subschema]) => [ k, schemaToMapping(subschema) ])
				)
			};
		case "array":
			if (schema.items.type !== "object") {
				// a primitive type can be single or an array in Elasticsearch
				return schemaToMapping(schema.items);
			} else {
				return {
					type: "nested",
					properties: Object.fromEntries(
						Object.entries(schema.items.properties)
							.map(([k, subschema]) => [ k, schemaToMapping(subschema) ])
					)
				}
			}	
	}
}

export default class ElasticDataAdapter implements IDataAdapter, ISchemaAdapter {
	elasticProxyAdapter: IProxyAdapter | null = null;
	delayMs = 1500;
	schemasIndexChecked = false;
	
	constructor(public context: AdapterContext, public props: ElasticAdapterProps) {
    }

	delay(ms: number): Promise<void> {
		return new Promise((res) => setInterval(() => res(), ms));
	}

	async ensureProxyAdapter() {
		if (this.elasticProxyAdapter === null) {
			this.elasticProxyAdapter = await this.context.getAdapter<IProxyAdapter>("./adapter/ElasticProxyAdapter.ts", {
				username: this.props.username,
				password: this.props.password,
				domainAndPort: this.props.domainAndPort
			});
		}
	}

	async requestElastic(msg: Message) {
		await this.ensureProxyAdapter();
		const sendMsg = await this.elasticProxyAdapter!.buildMessage(msg);
		return await this.context.makeRequest(sendMsg);
	}

	async readKey(dataset: string, key: string): Promise<number | Record<string,unknown>> {
		const msg = new Message(`/${dataset}/_source/${key}`, this.context.tenant, "GET");
		const msgOut = await this.requestElastic(msg);
		if (!msgOut.ok) {
			return msgOut.status;
		} else {
			const data = await msgOut.data?.asJson();
			return data;
		}
	}

	async listDataset(dataset: string): Promise<number | PathInfo[]> {
		if (dataset === '') {
			const msg = new Message("/_aliases", this.context.tenant, "GET");
			const msgOut = await this.requestElastic(msg);
			if (!msgOut.ok) {
				return msgOut.status;
			} else {
				const data = await msgOut.data?.asJson();
				const listing = Object.keys(data)
					.filter(k => k !== "_schemas")
					.map(k => [ k + '/' ] as PathInfo);
				return listing;
			}
		} else {
			const msg = new Message(`/${dataset}/_search`, this.context.tenant, "POST");
			msg.setDataJson({
				query: {
					match_all: {}
				},
				"fields": [
					"_id", "_timestamp"
				]
			});
			const msgOut = await this.requestElastic(msg);
			if (msgOut.status === 404) {
				return []; // missing directory returns empty listing
			} else if (!msgOut.ok) {
				return msgOut.status;
			} else {
				const data = await msgOut.data?.asJson();
				const listing = (data.hits.hits as any[]).map((h: any) => (h.fields._timestamp ? [ h._id, h._source._timestamp ] : [ h._id ]) as PathInfo);
				// if not a 404, then a schema was exists in .schemas
				listing.push([ '.schema.json' ] as PathInfo);
				return listing;
			}
		}
	}

	async writeKey(dataset: string, key: string, data: MessageBody): Promise<number> {
		const msg = new Message(`/${dataset}/_doc/${key}`, this.context.tenant, "PUT");
		const writeData = await data.asJson();
		writeData._timestamp = new Date().getTime();
		msg.setDataJson(writeData);
		const msgOut = await this.requestElastic(msg);
		if (!msgOut.ok) {
			return msgOut.status;
		} else {
			const data = await msgOut.data?.asJson();
			await this.delay(this.delayMs);
			return data.result === "created" ? 201 : 200;
		}
	}

	async deleteKey(dataset: string, key: string): Promise<number> {
		const msg = new Message(`/${dataset}/_doc/${key}`, this.context.tenant, "DELETE");
		const msgOut = await this.requestElastic(msg);
		await this.delay(this.delayMs);
		return msgOut.status;
	}

	async deleteDataset(dataset: string): Promise<number> {
		const msg = new Message(`/${dataset}`, this.context.tenant, "DELETE");
		const msgOut = await this.requestElastic(msg);
		await this.delay(this.delayMs);
		return msgOut.status;
	}

	async checkKey(dataset: string, key: string): Promise<ItemMetadata> {
		const msg = new Message(`/${dataset}/_doc/${key}`, this.context.tenant, "GET");
		const msgOut = await this.requestElastic(msg);
		let status : "none" | "directory" | "file" = "none";
		if (!msgOut.ok) {
			return { status } as ItemNone;
		} else {
			const data = await msgOut.data?.asJson();
			if (!data.found) {
				return { status } as ItemNone;
			}
			status = "file";
			return {
				status,
				dateModified: new Date(data._source._timestamp),
				size: JSON.stringify(data._source).length
			};
		}
	}

	async ensureSchemasIndex() {
		if (!this.schemasIndexChecked) {
			const msg = new Message(`/.schemas`, this.context.tenant, "GET");
			const msgCheck = await this.requestElastic(msg);
			if (!msgCheck.ok) {
				const createMappingMsg = new Message('/.schemas', this.context.tenant, "PUT");
				createMappingMsg.setDataJson({ settings: { index: { hidden: true } } });
				const msgCreated = await this.requestElastic(createMappingMsg);
				if (!msgCreated.ok) {
					this.context.logger.error(`Failed to create .schemas index on ${this.props.domainAndPort}, request status ${msgCreated.status}`);
				}
			}
			this.schemasIndexChecked = true;
		}
	}

	async writeSchema(dataset: string, schema: Record<string,unknown>): Promise<number> {
		const mapping = schemaToMapping(schema);
		const msg = new Message(`/${dataset}`, this.context.tenant, "GET");
		const msgCheck = await this.requestElastic(msg);
		const setMappingMsg = new Message(`/${dataset}/_mapping`, this.context.tenant, "PUT");
		let resCode = 200;
		setMappingMsg.setDataJson(mapping);
		if (!msgCheck.ok) {
			setMappingMsg.setUrl(`/${dataset}`).setMethod("PUT");
			setMappingMsg.setDataJson({ mappings: mapping });
			resCode = 201;
		}
		const msgOut = await this.requestElastic(setMappingMsg);
		if (!msgOut.ok) {
			return msgOut.status;
		}
		await this.ensureSchemasIndex();
		const storeRes = await this.writeKey('.schemas', dataset, MessageBody.fromObject({ schema: JSON.stringify(schema) }));
		if (storeRes >= 300) {
			return storeRes;
		}
		
		return resCode;
	}

	async readSchema(dataset: string): Promise<number | Record<string,unknown>> {
		const schemaStore = await this.readKey('.schemas', dataset);
		if (typeof schemaStore === 'number') return schemaStore;
		return JSON.parse(schemaStore.schema as string);
	}

	async checkSchema(dataset: string): Promise<ItemMetadata> {
		return await this.checkKey('.schemas', dataset);
	}

	instanceContentType(dataset: string, baseUrl: string): Promise<string> {
		const url = [ baseUrl, dataset, '.schema.json' ].filter(s => s !== '').join('/');
        return Promise.resolve(`application/json; schema="${url}"`);
	}
}