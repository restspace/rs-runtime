import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";
import { ItemMetadata, ItemNone } from "rs-core/ItemMetadata.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { MongoClient, Db, ObjectId, ServerApiVersion } from "mongodb";

export interface MongoDbDataAdapterProps {
    url: string;
}

export default class MongoDbDataAdapter implements IDataAdapter, ISchemaAdapter {
    private client: MongoClient | null = null;
    private db: Db | null = null;
    private schemasDbChecked = false;
    
    constructor(public context: AdapterContext, public props: MongoDbDataAdapterProps) {
    }

    private async ensureConnection() {
        if (!this.client) {
            this.client = new MongoClient(this.props.url, {
                serverApi: {
                  version: ServerApiVersion.v1,
                  strict: true,
                  deprecationErrors: true,
                }
              });
            await this.client.connect();
            this.db = this.client.db("Atelyr0");
        }
    }

    async readKey(dataset: string, key: string): Promise<number | Record<string,unknown>> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            const doc = await this.db!.collection(collection).findOne({ _id: new ObjectId(key) });
            return doc || 404;
        } catch (err) {
            this.context.logger.error(`MongoDB read error: ${err}`);
            return 500;
        }
    }

    async writeKey(dataset: string, key: string | undefined, data: MessageBody): Promise<number> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        let writeData = await data.asJson();
        if (!(writeData && typeof writeData === 'object')) {
            writeData = { data: writeData };
        }
        writeData._timestamp = new Date().getTime();
        if (key) writeData._id = 
            ObjectId.isValid(key) && String(new ObjectId(key)) === key
                ? new ObjectId(key)
                : key;

        try {
            if (!key) {
                // For empty key, let MongoDB generate the _id
                await this.db!.collection(collection).insertOne(writeData);
                if (writeData._id) return writeData._id.toString();
                return 201;
            } else {
                const result = await this.db!.collection(collection).updateOne(
                    { _id: new ObjectId(key) },
                    { $set: writeData },
                    { upsert: true }
                );
                return result.upsertedCount > 0 ? 201 : 200;
            }
        } catch (err) {
            this.context.logger.error(`MongoDB write error: ${err}`);
            return 500;
        }
    }

    async deleteKey(dataset: string, key: string): Promise<number> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            await this.db!.collection(collection).deleteOne({ _id: new ObjectId(key) });
            return 200;
        } catch (err) {
            this.context.logger.error(`MongoDB delete error: ${err}`);
            return 500;
        }
    }

    async listDataset(dataset: string, take = 1000, skip = 0): Promise<number | PathInfo[]> {
        await this.ensureConnection();
        
        // Handle empty dataset - list all collections
        if (!dataset) {
            try {
                const collections = (await this.db!.listCollections().toArray()).map(col => col.name);
                const schemaDatasets = await this.db!.collection('_schemas').find({}, { projection: { dataset: 1 } }).toArray();
                const newSchemas = schemaDatasets
                    .filter(schema => !collections.find(col => col === schema.dataset))
                    .map(schema => schema.dataset);
                collections.push(...newSchemas);
                const pathInfos = collections
                    .filter(col => col !== '_schemas') // Exclude internal schemas collection
                    .map(col => [col + '/'] as PathInfo);
                return pathInfos;
            } catch (err) {
                this.context.logger.error(`MongoDB list collections error: ${err}`);
                return 500;
            }
        }

        // Existing collection-specific logic
        const collection = this.normalizeCollectionName(dataset);
        try {
            const docs = await this.db!.collection(collection)
                .find({}, { projection: { _id: 1 } })
                .limit(take)
                .skip(skip)
                .toArray();
            const pathInfos = docs.map(doc => [doc._id.toString()] as PathInfo);
            const schema = await this.db!.collection('_schemas').findOne({ dataset: collection });
            if (schema) pathInfos.push([ '.schema.json' ] as PathInfo);
            return pathInfos;
        } catch (err) {
            this.context.logger.error(`MongoDB list error: ${err}`);
            return 500;
        }
    }

    normalizeCollectionName(s: string): string {
        if (s === '.' || s === '..') throw new Error('Invalid collection name');
        return s.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
    }

    async ensureSchemasIndex() {
        if (!this.schemasDbChecked) {
            await this.ensureConnection();
            try {
                const collections = await this.db!.listCollections().toArray();
                if (!collections.find(c => c.name === '_schemas')) {
                    await this.db!.createCollection('_schemas');
                }
                this.schemasDbChecked = true;
            } catch (err) {
                this.context.logger.error(`Failed to create _schemas collection: ${err}`);
            }
        }
    }

    async writeSchema(dataset: string, schema: Record<string, unknown>): Promise<number> {
        await this.ensureConnection();
        await this.ensureSchemasIndex();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            const result = await this.db!.collection('_schemas').updateOne(
                { dataset: collection },
                { $set: { 
                    dataset: collection,
                    schema: JSON.stringify(schema),
                    _timestamp: new Date().getTime()
                } },
                { upsert: true }
            );
            return result.upsertedCount > 0 ? 201 : 200;
        } catch (err) {
            this.context.logger.error(`MongoDB schema write error: ${err}`);
            return 500;
        }
    }

    async readSchema(dataset: string): Promise<number | Record<string,unknown>> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            const doc = await this.db!.collection('_schemas').findOne({ dataset: collection });
            if (!doc) return 404;
            return JSON.parse(doc.schema as string);
        } catch (err) {
            this.context.logger.error(`MongoDB schema read error: ${err}`);
            return 500;
        }
    }

    async checkSchema(dataset: string): Promise<ItemMetadata> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            const doc = await this.db!.collection('_schemas').findOne({ dataset: collection });
            if (!doc) return { status: 'none' } as ItemNone;
            return {
                status: 'file',
                dateModified: doc._timestamp ? new Date(doc._timestamp) : new Date(0),
                size: doc.schema ? doc.schema.length : 0
            };
        } catch (err) {
            this.context.logger.error(`MongoDB schema check error: ${err}`);
            return { status: 'none' } as ItemNone;
        }
    }

    async deleteDataset(dataset: string): Promise<number> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            await this.db!.collection(collection).drop();
            // Also delete the schema if it exists
            await this.db!.collection('_schemas').deleteOne({ dataset: collection });
            return 200;
        } catch (err) {
            this.context.logger.error(`MongoDB delete dataset error: ${err}`);
            return 500;
        }
    }

    instanceContentType(dataset: string, baseUrl: string): Promise<string> {
        const url = [baseUrl, dataset, '.schema.json'].filter(s => s !== '').join('/');
        return Promise.resolve(`application/json; schema="${url}"`);
    }

    async close(): Promise<void> {
        if (this.client) {
            this.client.close();
            this.client = null;
            this.db = null;
            this.schemasDbChecked = false;
        }
    }

    async checkKey(dataset: string, key: string): Promise<ItemMetadata> {
        await this.ensureConnection();
        const collection = this.normalizeCollectionName(dataset);
        
        try {
            const doc = await this.db!.collection(collection).findOne(
                { _id: new ObjectId(key) },
                { projection: { _timestamp: 1 } }
            );
            
            if (!doc) {
                return { status: 'none' } as ItemNone;
            }
            
            return {
                status: 'file',
                dateModified: doc._timestamp ? new Date(doc._timestamp) : new Date(0),
                size: 0  // Since we don't store the size explicitly
            };
        } catch (err) {
            this.context.logger.error(`MongoDB check key error: ${err}`);
            return { status: 'none' } as ItemNone;
        }
    }
}