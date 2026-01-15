import { IDataAdapter, IDataFieldFilterableAdapter, DataFieldFilter } from "rs-core/adapter/IDataAdapter.ts";
import { ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";
import { ItemMetadata, ItemNone } from "rs-core/ItemMetadata.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Db, MongoClient } from "mongodb";
import {
  MongoDbConnectionProps,
  mongoErrorToHttpStatus,
  isMongoTransientError,
  normalizeCollectionName,
  parseId,
  resolveMongoUrl,
  withFastRetry,
} from "./mongoDbCommon.ts";

export interface MongoDbDataAdapterProps extends MongoDbConnectionProps {
  /** Where schemas are stored. Defaults to "_schemas". */
  schemaCollection?: string;
}

export default class MongoDbDataAdapter implements IDataAdapter, ISchemaAdapter, IDataFieldFilterableAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  /** Indicates this adapter supports data-field filtering for listings */
  supportsDataFieldFiltering = true;

  constructor(public context: AdapterContext, public props: MongoDbDataAdapterProps) {}

  private schemaCollection() {
    return this.props.schemaCollection || "_schemas";
  }

  private async ensureConnection() {
    if (this.client) return;

    const resolvedUrl = await resolveMongoUrl(this.props.url);

    // Use an `any` options bag to keep the adapter compatible across mongodb driver versions.
    const options: any = {};
    if (this.props.tlsCAFile) options.tlsCAFile = this.props.tlsCAFile;

    this.client = new MongoClient(resolvedUrl, options);
    await this.client.connect();
    this.db = this.client.db(this.props.dbName);
  }

  private async ensureSchemasCollection() {
    await this.ensureConnection();
    const schemas = this.schemaCollection();
    const existing = await this.db!.listCollections({ name: schemas }).toArray();
    if (existing.length === 0) {
      await this.db!.createCollection(schemas);
    }
  }

  async readKey(dataset: string, key: string): Promise<number | Record<string, unknown>> {
    await this.ensureConnection();
    const collection = normalizeCollectionName(dataset);

    try {
      const doc = await this.db!.collection(collection).findOne({ _id: parseId(key) } as any);
      return doc || 404;
    } catch (err) {
      this.context.logger.error(`MongoDB read error: ${err}`);
      return 500;
    }
  }

  async writeKey(dataset: string, key: string | undefined, data: MessageBody): Promise<number> {
    await this.ensureConnection();
    const collection = normalizeCollectionName(dataset);

    let writeData: any = await data.asJson();
    if (!(writeData && typeof writeData === "object")) {
      writeData = { data: writeData };
    }
    writeData._timestamp = new Date().getTime();

    try {
      const coll = this.db!.collection(collection);

      if (!key) {
        return await withFastRetry(
          async () => {
            // Let MongoDB generate the _id.
            const result: any = await coll.insertOne(writeData);
            const inserted = result?.insertedId ?? writeData._id;
            return (inserted?.toString?.() ?? 201) as any;
          },
          isMongoTransientError,
        );
      }

      const id = parseId(key);
      // Never try to replace _id via $set.
      const { _id: _ignored, ...doc } = writeData;

      return await withFastRetry(
        async () => {
          const result = await coll.updateOne(
            { _id: id } as any,
            { $set: doc },
            { upsert: true },
          );
          return (result.upsertedCount ?? 0) > 0 ? 201 : 200;
        },
        isMongoTransientError,
      );
    } catch (err) {
      this.context.logger.error(`MongoDB write error: ${err}`);
      return mongoErrorToHttpStatus(err);
    }
  }

  async deleteKey(dataset: string, key: string): Promise<number> {
    await this.ensureConnection();
    const collection = normalizeCollectionName(dataset);

    try {
      return await withFastRetry(
        async () => {
          const result = await this.db!.collection(collection).deleteOne({ _id: parseId(key) } as any);
          return result.deletedCount && result.deletedCount > 0 ? 200 : 404;
        },
        isMongoTransientError,
      );
    } catch (err) {
      this.context.logger.error(`MongoDB delete error: ${err}`);
      return mongoErrorToHttpStatus(err);
    }
  }

  async listDataset(dataset: string, take = 1000, skip = 0): Promise<number | PathInfo[]> {
    await this.ensureConnection();

    // Top-level listing: collections.
    if (!dataset) {
      try {
        const collections = (await this.db!.listCollections().toArray()).map((col) => col.name);

        // Ensure schema collection exists so we can include schema-only datasets.
        await this.ensureSchemasCollection();
        const schemas = this.schemaCollection();
        const schemaDatasets = await this.db!.collection(schemas)
          .find({}, { projection: { dataset: 1 } as any })
          .toArray();

        const schemaNames = schemaDatasets
          .map((s: any) => s.dataset)
          .filter((s: any) => typeof s === "string") as string[];

        const all = new Set<string>([...collections, ...schemaNames]);
        all.delete(schemas);

        return [...all].sort().map((name) => [name + "/"] as PathInfo);
      } catch (err) {
        this.context.logger.error(`MongoDB list collections error: ${err}`);
        return 500;
      }
    }

    const collection = normalizeCollectionName(dataset);

    try {
      const docs = await this.db!.collection(collection)
        .find({}, { projection: { _id: 1, _timestamp: 1 } as any })
        .limit(take)
        .skip(skip)
        .toArray();

      const pathInfos: PathInfo[] = docs.map((doc: any) => (
        doc._timestamp ? [doc._id.toString(), doc._timestamp] as PathInfo : [doc._id.toString()] as PathInfo
      ));

      await this.ensureSchemasCollection();
      const schemas = this.schemaCollection();
      const schema = await this.db!.collection(schemas).findOne({ dataset: collection });
      if (schema) pathInfos.push([".schema.json"] as PathInfo);

      return pathInfos;
    } catch (err) {
      // Missing collection should behave like missing directory.
      const msg = String((err as any)?.message || err);
      if (msg.toLowerCase().includes("ns not found") || msg.toLowerCase().includes("namespace not found")) {
        return [];
      }
      this.context.logger.error(`MongoDB list error: ${err}`);
      return 500;
    }
  }

  async listDatasetWithFilter(
    dataset: string,
    filters: DataFieldFilter[],
    take = 1000,
    skip = 0
  ): Promise<PathInfo[] | number> {
    await this.ensureConnection();

    if (filters.length === 0) {
      return [];
    }

    // Top-level listing doesn't support filtering
    if (!dataset) {
      return this.listDataset(dataset, take, skip);
    }

    const collection = normalizeCollectionName(dataset);

    try {
      // Build MongoDB filter from DataFieldFilters
      const mongoFilter: Record<string, unknown> = {};
      for (const filter of filters) {
        if (!filter.dataFieldName || filter.userFieldValue === undefined || filter.userFieldValue === null) {
          return [];
        }
        mongoFilter[filter.dataFieldName] = { $eq: filter.userFieldValue };
      }

      const docs = await this.db!.collection(collection)
        .find(mongoFilter, { projection: { _id: 1, _timestamp: 1 } as any })
        .limit(take)
        .skip(skip)
        .toArray();

      const pathInfos: PathInfo[] = docs.map((doc: any) =>
        doc._timestamp
          ? ([doc._id.toString(), doc._timestamp] as PathInfo)
          : ([doc._id.toString()] as PathInfo)
      );

      // Include schema if present
      await this.ensureSchemasCollection();
      const schemas = this.schemaCollection();
      const schema = await this.db!.collection(schemas).findOne({ dataset: collection });
      if (schema) pathInfos.push([".schema.json"] as PathInfo);

      return pathInfos;
    } catch (err) {
      const msg = String((err as any)?.message || err);
      if (msg.toLowerCase().includes("ns not found") || msg.toLowerCase().includes("namespace not found")) {
        return [];
      }
      this.context.logger.error(`MongoDB filtered list error: ${err}`);
      return 500;
    }
  }

  async deleteDataset(dataset: string): Promise<number> {
    await this.ensureConnection();
    const collection = normalizeCollectionName(dataset);

    try {
      const exists = await this.db!.listCollections({ name: collection }).toArray();
      if (exists.length === 0) return 404;

      return await withFastRetry(
        async () => {
          await this.db!.collection(collection).drop();

          await this.ensureSchemasCollection();
          const schemas = this.schemaCollection();
          await this.db!.collection(schemas).deleteOne({ dataset: collection });

          return 200;
        },
        isMongoTransientError,
      );
    } catch (err) {
      this.context.logger.error(`MongoDB delete dataset error: ${err}`);
      return mongoErrorToHttpStatus(err);
    }
  }

  async checkKey(dataset: string, key: string): Promise<ItemMetadata> {
    await this.ensureConnection();
    const collection = normalizeCollectionName(dataset);

    try {
      const doc = await this.db!.collection(collection).findOne(
        { _id: parseId(key) } as any,
        { projection: { _timestamp: 1 } as any },
      );

      if (!doc) return { status: "none" } as ItemNone;

      return {
        status: "file",
        dateModified: doc._timestamp ? new Date(doc._timestamp) : new Date(0),
        size: 0,
      };
    } catch (err) {
      this.context.logger.error(`MongoDB check key error: ${err}`);
      return { status: "none" } as ItemNone;
    }
  }

  async writeSchema(dataset: string, schema: Record<string, unknown>): Promise<number> {
    await this.ensureConnection();
    await this.ensureSchemasCollection();

    const collection = normalizeCollectionName(dataset);
    const schemas = this.schemaCollection();

    try {
      return await withFastRetry(
        async () => {
          const result = await this.db!.collection(schemas).updateOne(
            { dataset: collection },
            {
              $set: {
                dataset: collection,
                schema: JSON.stringify(schema),
                _timestamp: new Date().getTime(),
              },
            },
            { upsert: true },
          );

          return (result.upsertedCount ?? 0) > 0 ? 201 : 200;
        },
        isMongoTransientError,
      );
    } catch (err) {
      this.context.logger.error(`MongoDB schema write error: ${err}`);
      return mongoErrorToHttpStatus(err);
    }
  }

  async readSchema(dataset: string): Promise<number | Record<string, unknown>> {
    await this.ensureConnection();
    await this.ensureSchemasCollection();

    const collection = normalizeCollectionName(dataset);
    const schemas = this.schemaCollection();

    try {
      const doc: any = await this.db!.collection(schemas).findOne({ dataset: collection });
      if (!doc) return 404;
      return JSON.parse(doc.schema as string);
    } catch (err) {
      this.context.logger.error(`MongoDB schema read error: ${err}`);
      return 500;
    }
  }

  async checkSchema(dataset: string): Promise<ItemMetadata> {
    await this.ensureConnection();
    await this.ensureSchemasCollection();

    const collection = normalizeCollectionName(dataset);
    const schemas = this.schemaCollection();

    try {
      const doc: any = await this.db!.collection(schemas).findOne({ dataset: collection });
      if (!doc) return { status: "none" } as ItemNone;

      return {
        status: "file",
        dateModified: doc._timestamp ? new Date(doc._timestamp) : new Date(0),
        size: doc.schema ? String(doc.schema).length : 0,
      };
    } catch (err) {
      this.context.logger.error(`MongoDB schema check error: ${err}`);
      return { status: "none" } as ItemNone;
    }
  }

  instanceContentType(dataset: string, baseUrl: string): Promise<string> {
    const url = [baseUrl, dataset, ".schema.json"].filter((s) => s !== "").join("/");
    return Promise.resolve(`application/json; schema=\"${url}\"`);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}
