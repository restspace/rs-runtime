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

class HttpStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDateTimeSchema(schema: unknown): boolean {
  const s = schema as any;
  return s && typeof s === "object" && s.type === "string" && s.format === "date-time";
}

function parseRfc3339DateTime(value: string): Date {
  // Strict-ish RFC 3339: YYYY-MM-DDTHH:MM:SS(.sss)?(Z|±HH:MM)
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!re.test(value)) {
    throw new HttpStatusError(400, "Invalid RFC 3339 date-time string");
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    throw new HttpStatusError(400, "Invalid RFC 3339 date-time string");
  }
  return d;
}

function parseMongoCollation(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "string") {
    throw new HttpStatusError(400, 'Invalid "collation" value; expected string "<locale> <level>"');
  }
  const parts = value.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length !== 2) {
    throw new HttpStatusError(400, 'Invalid "collation" value; expected "<locale> <level>"');
  }
  const [locale, levelStr] = parts;
  const strength = Number(levelStr);
  if (!locale || !Number.isInteger(strength) || strength < 1 || strength > 5) {
    throw new HttpStatusError(400, 'Invalid "collation" value; expected "<locale> <level>" with level 1-5');
  }
  return { locale, strength };
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  // undefined / bigint / function shouldn't appear in persisted schema or index specs
  return JSON.stringify(value);
}

function shortDeterministicHash(text: string): string {
  // Non-crypto, deterministic hash used only for index names (not security-sensitive)
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function convertDatesForWrite(value: unknown, schema: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (isDateTimeSchema(schema)) {
    if (value instanceof Date) return value;
    if (typeof value === "string") return parseRfc3339DateTime(value);
    throw new HttpStatusError(400, "Invalid RFC 3339 date-time value");
  }

  const s: any = schema as any;
  if (!s || typeof s !== "object") return value;

  if (s.type === "object" && isPlainObject(value) && isPlainObject(s.properties)) {
    for (const [prop, propSchema] of Object.entries(s.properties as Record<string, unknown>)) {
      if (Object.prototype.hasOwnProperty.call(value, prop)) {
        (value as any)[prop] = convertDatesForWrite((value as any)[prop], propSchema);
      }
    }
    return value;
  }

  if (s.type === "array" && Array.isArray(value)) {
    const itemsSchema = s.items;
    if (itemsSchema !== undefined) {
      for (let i = 0; i < value.length; i++) {
        value[i] = convertDatesForWrite(value[i], itemsSchema);
      }
    }
    return value;
  }

  return value;
}

function convertDatesForRead(value: unknown, schema: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (isDateTimeSchema(schema)) {
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  const s: any = schema as any;
  if (!s || typeof s !== "object") return value;

  if (s.type === "object" && isPlainObject(value) && isPlainObject(s.properties)) {
    for (const [prop, propSchema] of Object.entries(s.properties as Record<string, unknown>)) {
      if (Object.prototype.hasOwnProperty.call(value, prop)) {
        (value as any)[prop] = convertDatesForRead((value as any)[prop], propSchema);
      }
    }
    return value;
  }

  if (s.type === "array" && Array.isArray(value)) {
    const itemsSchema = s.items;
    if (itemsSchema !== undefined) {
      for (let i = 0; i < value.length; i++) {
        value[i] = convertDatesForRead(value[i], itemsSchema);
      }
    }
    return value;
  }

  return value;
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

  private async getSchemaRecord(datasetCollection: string): Promise<Record<string, unknown> | null> {
    await this.ensureConnection();
    await this.ensureSchemasCollection();
    const schemas = this.schemaCollection();
    const doc: any = await this.db!.collection(schemas).findOne({ dataset: datasetCollection });
    return doc ? (doc as Record<string, unknown>) : null;
  }

  private async getSchemaRequired(datasetCollection: string): Promise<JsonSchema> {
    const rec = await this.getSchemaRecord(datasetCollection);
    if (!rec || typeof rec.schema !== "string") {
      throw new HttpStatusError(500, "Missing .schema.json for dataset");
    }
    try {
      const parsed = JSON.parse(rec.schema as string);
      if (!parsed || typeof parsed !== "object") throw new Error("Schema must be a JSON object");
      return parsed as JsonSchema;
    } catch (err) {
      this.context.logger.error(`MongoDB schema parse error: ${err}`);
      throw new HttpStatusError(500, "Invalid .schema.json for dataset");
    }
  }

  private async compileIndexModels(datasetCollection: string, schema: JsonSchema): Promise<{ hash: string; models: any[] }> {
    const schemaAny: any = schema as any;
    if (!schemaAny || typeof schemaAny !== "object") {
      throw new HttpStatusError(400, "Schema must be a JSON object");
    }

    const models: any[] = [];
    const seen = new Set<string>();
    const canonicals: string[] = [];

    const addIndex = (keys: Record<string, number>, options: Record<string, unknown>) => {
      const normalizedOptions: Record<string, unknown> = { ...options };
      // normalize partial field name
      if ((normalizedOptions as any).partial !== undefined) {
        const partial = (normalizedOptions as any).partial;
        delete (normalizedOptions as any).partial;
        if (!isPlainObject(partial)) {
          throw new HttpStatusError(400, 'Invalid "partial" value; expected object');
        }
        normalizedOptions.partialFilterExpression = partial;
      }
      // normalize collation string
      if ((normalizedOptions as any).collation !== undefined) {
        const collation = parseMongoCollation((normalizedOptions as any).collation);
        delete (normalizedOptions as any).collation;
        if (Object.keys(collation).length > 0) {
          normalizedOptions.collation = collation;
        }
      }

      const canonical = stableStringify({ keys, options: normalizedOptions });
      if (seen.has(canonical)) return;
      seen.add(canonical);
      canonicals.push(canonical);

      // Deterministic managed name (kept short-ish to avoid provider limits)
      const fieldPart = Object.keys(keys).join("_").slice(0, 40);
      const nameHash = shortDeterministicHash(canonical);
      models.push({
        keys,
        options: {
          ...normalizedOptions,
          name: `rs_${datasetCollection}_${fieldPart}_${nameHash}`.slice(0, 110),
        },
      });
    };

    // Field-level directives (single-column)
    if (schemaAny.type === "object" && isPlainObject(schemaAny.properties)) {
      for (const [field, fieldSchema] of Object.entries(schemaAny.properties as Record<string, unknown>)) {
        const fs: any = fieldSchema as any;
        if (!fs || typeof fs !== "object") continue;

        const wantsUnique = fs.unique === true;
        const wantsIndex = fs.index === true;

        const ttlSeconds = fs["x-mongo-expiry-seconds"];
        const hasTtl = ttlSeconds !== undefined;

        if (hasTtl && wantsUnique) {
          throw new HttpStatusError(400, 'Invalid schema: "x-mongo-expiry-seconds" cannot be combined with "unique"');
        }

        const isDateTime = isDateTimeSchema(fs);
        if (hasTtl && isDateTime) {
          if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
            throw new HttpStatusError(400, 'Invalid "x-mongo-expiry-seconds"; expected a non-negative number');
          }
        }
        const ttlValid = hasTtl && isDateTime;

        if (wantsUnique || wantsIndex || ttlValid) {
          const options: Record<string, unknown> = {};
          if (wantsUnique) options.unique = true;
          if (ttlValid) options.expireAfterSeconds = ttlSeconds;
          if (fs.collation !== undefined) options.collation = fs.collation;
          if (fs.partial !== undefined) options.partial = fs.partial;
          addIndex({ [field]: 1 }, options);
        }
      }
    }

    // Composite indexes
    const idx = schemaAny.indexes;
    if (idx !== undefined) {
      if (!Array.isArray(idx)) {
        throw new HttpStatusError(400, 'Invalid "indexes"; expected array');
      }
      for (const entry of idx) {
        if (Array.isArray(entry)) {
          if (!entry.every((f) => typeof f === "string" && f.length > 0)) {
            throw new HttpStatusError(400, 'Invalid "indexes" entry; expected array of non-empty strings');
          }
          const keys: Record<string, number> = {};
          for (const f of entry as string[]) keys[f] = 1;
          addIndex(keys, {});
          continue;
        }
        if (isPlainObject(entry)) {
          const fields = (entry as any).fields;
          if (!Array.isArray(fields) || !fields.every((f) => typeof f === "string" && f.length > 0)) {
            throw new HttpStatusError(400, 'Invalid "indexes" object; expected "fields": string[]');
          }
          const keys: Record<string, number> = {};
          for (const f of fields as string[]) keys[f] = 1;

          const options: Record<string, unknown> = {};
          if ((entry as any).unique === true) options.unique = true;
          if ((entry as any).collation !== undefined) options.collation = (entry as any).collation;
          if ((entry as any).partial !== undefined) options.partial = (entry as any).partial;
          addIndex(keys, options);
          continue;
        }
        throw new HttpStatusError(400, 'Invalid "indexes" entry; expected string[] or object');
      }
    }

    canonicals.sort();
    const hash = await sha256Hex(canonicals.join("|"));
    return { hash, models };
  }

  async readKey(dataset: string, key: string): Promise<number | Record<string, unknown>> {
    await this.ensureConnection();
    const collection = normalizeCollectionName(dataset);

    try {
      const schema = await this.getSchemaRequired(collection);
      const doc = await this.db!.collection(collection).findOne({ _id: parseId(key) } as any);
      if (!doc) return 404;
      return convertDatesForRead(doc, schema) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof HttpStatusError) return err.status;
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
      const schema = await this.getSchemaRequired(collection);
      convertDatesForWrite(writeData, schema);
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
      if (err instanceof HttpStatusError) return err.status;
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
      const existing = await this.db!.collection(schemas).findOne({ dataset: collection } as any);
      const compiled = await this.compileIndexModels(collection, schema as JsonSchema);
      const existingHash = (existing as any)?.indexSpecHash;

      if (existingHash !== compiled.hash) {
        const coll = this.db!.collection(collection);
        await withFastRetry(
          async () => {
            for (const model of compiled.models) {
              await coll.createIndex(model.keys, model.options as any);
            }
          },
          isMongoTransientError,
        );
      }

      return await withFastRetry(
        async () => {
          const now = new Date().getTime();
          const setObj: Record<string, unknown> = {
            dataset: collection,
            schema: JSON.stringify(schema),
            _timestamp: now,
            indexSpecHash: compiled.hash,
          };
          if (existingHash !== compiled.hash) {
            setObj.indexesAppliedAt = now;
          }
          const result = await this.db!.collection(schemas).updateOne(
            { dataset: collection },
            {
              $set: {
                ...setObj,
              },
            },
            { upsert: true },
          );

          return (result.upsertedCount ?? 0) > 0 ? 201 : 200;
        },
        isMongoTransientError,
      );
    } catch (err) {
      if (err instanceof HttpStatusError) return err.status;
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
