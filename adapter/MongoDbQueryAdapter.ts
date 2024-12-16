import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext, contextLoggerArgs } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { upTo } from "rs-core/utility/utility.ts";
import { Db, FindOptions, MongoClient, MongoClientOptions, ServerApiVersion } from "mongodb";

export interface MongoDbQueryAdapterProps {
	url: string;
}

export default class MongoDbQueryAdapter implements IQueryAdapter {
	private client: MongoClient | null = null;
    private db: Db | null = null;
	
	constructor(public context: AdapterContext, public props: MongoDbQueryAdapterProps) {
    }

    private async ensureConnection() {
        if (!this.client) {
            this.client = new MongoClient(this.props.url, {
                serverApi: {
                  version: ServerApiVersion.v1,
                  strict: true,
                  deprecationErrors: true,
                }
              } as MongoClientOptions);
            await this.client.connect();
            this.db = this.client.db("Atelyr0");
        }
    }

	async runQuery(query: string, _: Record<string, unknown>, take = 1000, skip = 0): Promise<number | Record<string,unknown>[]> {
		await this.ensureConnection();
		
		let collection = 'default';
		let operation = 'find';
		
		let queryObj = {} as any;
		try {
			queryObj = JSON.parse(query);
		} catch (e) {
			this.context.logger.error(`Invalid JSON (${e}) in MongoDB query: ${query}`, ...contextLoggerArgs(this.context));
			return 400;
		}

		skip = queryObj.skip || skip;
		take = queryObj.take || take;

		// Extract collection name (previously 'index' in ES)
		if (queryObj.collection) {
			collection = queryObj.collection;
			delete queryObj.collection;
		}

		// Handle different operations
		if (queryObj.operation) {
			operation = queryObj.operation;
			delete queryObj.operation;
			
			if (!['find', 'findOne', 'updateMany', 'deleteMany', 'count'].includes(operation)) {
				this.context.logger.error(`Unknown operation in MongoDB query: ${operation}`, ...contextLoggerArgs(this.context));
				return 400;
			}
		}

		try {
			const coll = this.db?.collection(collection);
			if (!coll) throw new Error('Database not connected');

			switch (operation) {
				case 'find': {
					const cursor = coll.find(queryObj.filter || {});
					if (skip) cursor.skip(skip);
					if (take) cursor.limit(take);
					return await cursor.toArray();
				}
				
				case 'findOne': {
					const result = await coll.findOne(queryObj.filter || {});
					return result ? [result] : [];
				}
				
				case 'updateMany': {
					const updateResult = await coll.updateMany(
						queryObj.filter || {},
						queryObj.update || {}
					);
					return updateResult.modifiedCount;
				}
				
				case 'deleteMany': {
					const deleteResult = await coll.deleteMany(queryObj.filter || {});
					return deleteResult.deletedCount;
				}
				
				case 'count': {
					const count = await coll.countDocuments(queryObj.filter || {});
					return count;
				}
				
				default: {
					throw new Error(`Unsupported operation: ${operation}`);
				}
			}
		} catch (error) {
			this.context.logger.error(`MongoDB operation error: ${error}`, ...contextLoggerArgs(this.context));
			throw error;
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