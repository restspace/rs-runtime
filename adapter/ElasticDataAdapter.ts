import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";
import { ItemMetadata, ItemNone } from "rs-core/ItemMetadata.ts";
import { Message } from "rs-core/Message.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

// designed for compatibility with Elasticsearch 8.4

export interface ElasticAdapterProps {
	username: string;
	password: string;
	host: string;
	writeDelayMs?: number;
}

export const schemaToMapping = (schema: any): any => {
	let submapping: any = {};
	const esProps = [ 'type', 'fields', 'index', 'index_options', 'index_prefixes', 'index_phrases',
		'norms', 'store', 'search_analyzer', 'search_quote_analyzer', 'similarity', 'term_vector',
		'doc_values', 'eager_global_ordinals', 'ignore_above', 'null_value', 'normalizer',
		'split_queries_on_whitespace', 'time_series_dimension', 'coerce', 'ignore_malformed', 'scaling_factor',
		'format', 'locale', 'dynamic', 'enabled', 'subobjects', 'depth_limit', 'include_in_parent', 'include_in_root',
		'metrics', 'default_metric', 'fielddata', 'fielddata_frequency_filter', 'position_increment_gap',
		'preserve_separators', 'preserve_position_increments', 'max_input_length', 'max_shingle_size',
		'dims', 'ignore_z_value', 'orientation' ];
	switch (schema.type as string) {
		case "string": {
			submapping = schema.search === 'textual' ? { type: "text" }
				: ['date', 'date-time'].includes(schema.format || 'zzz') ? { type: "date" }
				: { type: "keyword" };
			[ 'fields', 'index', 'index_options', 'index_prefixes', 'index_phrases', 'norms', 'store', 'search_analyzer', 'search_quote_analyzer', 'similarity', 'term_vector' ]
				.forEach(k => {
					if (schema['es_' + k]) {
						submapping[k] = schema['es_' + k];
					}
				});
			break;
		}
		case "number":
			submapping = { type: "double" };
			break;
		case "boolean":
			submapping = { type: "boolean" };
			break;
		case "object":
			submapping = {
				properties: Object.fromEntries(
					Object.entries(schema.properties)
						.map(([k, subschema]) => [ k, schemaToMapping(subschema) ])
				)
			};
			break;
		case "array":
			if (schema.items.type !== "object") {
				// a primitive type can be single or an array in Elasticsearch
				submapping = schemaToMapping(schema.items);
			} else {
				submapping = {
					type: "nested",
					properties: Object.fromEntries(
						Object.entries(schema.items.properties)
							.map(([k, subschema]) => [ k, schemaToMapping(subschema) ])
					)
				}
			}	
	}
	Object.keys(schema).filter(k => k.startsWith('es_'))
		.forEach(k => {
			const esKey = k.substring(3);
			if (esProps.includes(esKey)) submapping[esKey] = schema[k];
		});
	return submapping;
}

export default class ElasticDataAdapter implements IDataAdapter, ISchemaAdapter {
	elasticProxyAdapter: IProxyAdapter | null = null;
	schemasIndexChecked = false;
	defaultWriteDelayMs = 1500;
	
	constructor(public context: AdapterContext, public props: ElasticAdapterProps) {
    }

	waitForWrite(): Promise<void> {
		return new Promise((res) => setInterval(() => res(),
			this.props.writeDelayMs || this.defaultWriteDelayMs));
	}

	normaliseIndexName(s: string) {
		if (s === '.' || s === '..') throw new Error('Elastic does not allow index names . or ..');
		return s.toLowerCase()
			.replace(/[\\/*?"<>| ,#]/g, '')
			.replace(/$[-_+]/, '')
			.slice(0, 255);
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
		msg.startSpan(this.context.traceparent, this.context.tracestate);
		await this.ensureProxyAdapter();
		const sendMsg = await this.elasticProxyAdapter!.buildMessage(msg);
		return await this.context.makeRequest(sendMsg);
	}

	async readKey(dataset: string, key: string): Promise<number | Record<string,unknown>> {
		dataset = this.normaliseIndexName(dataset);
		const msg = new Message(`/${dataset}/_source/${key}`, this.context.tenant, "GET", null);
		const msgOut = await this.requestElastic(msg);
		if (!msgOut.ok) {
			return msgOut.status;
		} else {
			const data = await msgOut.data?.asJson();
			return data;
		}
	}

	async listDataset(dataset: string, take = 1000, skip = 0): Promise<number | PathInfo[]> {
		if (dataset === '') {
			const msg = new Message("/_aliases", this.context.tenant, "GET", null);
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
			dataset = this.normaliseIndexName(dataset);
			const msg = new Message(`/${dataset}/_search`, this.context.tenant, "POST", null);
			msg.setDataJson({
				size: take,
				from: skip,
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
		dataset = this.normaliseIndexName(dataset);
		const msg = new Message(`/${dataset}/_doc/${key}`, this.context.tenant, "PUT", null);
		const writeData = await data.asJson();
		writeData._timestamp = new Date().getTime();
		msg.setDataJson(writeData);
		const msgOut = await this.requestElastic(msg);
		if (!msgOut.ok) {
			return msgOut.status;
		} else {
			const data = await msgOut.data?.asJson();
			await this.waitForWrite();
			return data.result === "created" ? 201 : 200;
		}
	}

	async deleteKey(dataset: string, key: string): Promise<number> {
		dataset = this.normaliseIndexName(dataset);
		const msg = new Message(`/${dataset}/_doc/${key}`, this.context.tenant, "DELETE", null);
		const msgOut = await this.requestElastic(msg);
		await this.waitForWrite();
		return msgOut.status;
	}

	async deleteDataset(dataset: string): Promise<number> {
		dataset = this.normaliseIndexName(dataset);
		const msg = new Message(`/${dataset}`, this.context.tenant, "DELETE", null);
		const msgOut = await this.requestElastic(msg);
		await this.waitForWrite();
		return msgOut.status;
	}

	async checkKey(dataset: string, key: string): Promise<ItemMetadata> {
		dataset = this.normaliseIndexName(dataset);
		const msg = new Message(`/${dataset}/_doc/${key}`, this.context.tenant, "GET", null);
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
			const msg = new Message(`/.schemas`, this.context.tenant, "GET", null);
			const msgCheck = await this.requestElastic(msg);
			if (!msgCheck.ok) {
				const createMappingMsg = new Message('/.schemas', this.context.tenant, "PUT", null);
				createMappingMsg.setDataJson({ settings: { index: { hidden: true } } });
				const msgCreated = await this.requestElastic(createMappingMsg);
				if (!msgCreated.ok) {
					this.context.logger.error(`Failed to create .schemas index on ${this.props.host}, request status ${msgCreated.status}`);
				}
			}
			this.schemasIndexChecked = true;
		}
	}

	async writeSchema(dataset: string, schema: Record<string, unknown>): Promise<number> {
		dataset = this.normaliseIndexName(dataset);
		const params: Record<string, unknown> = { mappings: schemaToMapping(schema) };
		if (schema['es_settings']) {
			params.es_settings = schema['es_settings'];
		}
		const msg = new Message(`/${dataset}`, this.context.tenant, "GET", null);
		const msgCheck = await this.requestElastic(msg);
		const setMappingMsg = new Message(`/${dataset}/_mapping`, this.context.tenant, "PUT", null);
		let resCode = 200;
		setMappingMsg.setDataJson(params.mappings);
		if (!msgCheck.ok) {
			setMappingMsg.setUrl(`/${dataset}`).setMethod("PUT");
			setMappingMsg.setDataJson(params);
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
		dataset = this.normaliseIndexName(dataset);
		const schemaStore = await this.readKey('.schemas', dataset);
		if (typeof schemaStore === 'number') return schemaStore;
		return JSON.parse(schemaStore.schema as string);
	}

	async checkSchema(dataset: string): Promise<ItemMetadata> {
		dataset = this.normaliseIndexName(dataset);
		return await this.checkKey('.schemas', dataset);
	}

	instanceContentType(dataset: string, baseUrl: string): Promise<string> {
		const url = [ baseUrl, dataset, '.schema.json' ].filter(s => s !== '').join('/');
        return Promise.resolve(`application/json; schema="${url}"`);
	}
}