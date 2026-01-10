import { AdapterContext, contextLoggerArgs } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { Db, MongoClient } from "mongodb";
import {
  applyAggregatePaging,
  MongoDbConnectionProps,
  mongoErrorToHttpStatus,
  isMongoTransientError,
  normalizeCollectionName,
  parseAggregateQuery,
  QueryFormatError,
  resolveMongoUrl,
  withFastRetry,
} from "./mongoDbCommon.ts";

export interface MongoDbQueryAdapterProps extends MongoDbConnectionProps {}

export default class MongoDbQueryAdapter implements IQueryAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(public context: AdapterContext, public props: MongoDbQueryAdapterProps) {}

  private async ensureConnection() {
    if (this.client) return;

    const resolvedUrl = await resolveMongoUrl(this.props.url);

    const options: any = {};
    if (this.props.tlsCAFile) options.tlsCAFile = this.props.tlsCAFile;

    this.client = new MongoClient(resolvedUrl, options);
    await this.client.connect();
    this.db = this.client.db(this.props.dbName);
  }

  async runQuery(
    query: string,
    _variables: Record<string, unknown>,
    take = 1000,
    skip = 0,
  ): Promise<number | Record<string, unknown>[]> {
    await this.ensureConnection();

    let queryObj: unknown;
    try {
      queryObj = JSON.parse(query);
    } catch (e) {
      this.context.logger.error(
        `Invalid JSON (${e}) in MongoDB aggregate query: ${query}`,
        ...contextLoggerArgs(this.context),
      );
      return 400;
    }

    let parsed;
    try {
      parsed = parseAggregateQuery(queryObj);
    } catch (e) {
      const msg = e instanceof QueryFormatError ? e.message : String(e);
      this.context.logger.error(
        `Invalid query format (${msg}) in MongoDB aggregate query: ${query}`,
        ...contextLoggerArgs(this.context),
      );
      return 400;
    }

    const collection = normalizeCollectionName(parsed.collection);
    const pipeline = applyAggregatePaging(
      parsed.pipeline,
      take,
      skip,
      parsed.page?.mode || "appendStages",
    );

    try {
      const coll = this.db?.collection(collection);
      if (!coll) throw new Error("Database not connected");

      return await withFastRetry(
        async () => {
          const cursor = coll.aggregate(pipeline as any, (parsed.options || {}) as any);
          const rows = await cursor.toArray();
          return rows as unknown as Record<string, unknown>[];
        },
        isMongoTransientError,
      );
    } catch (error) {
      this.context.logger.error(
        `MongoDB aggregate error: ${error}`,
        ...contextLoggerArgs(this.context),
      );
      return mongoErrorToHttpStatus(error);
    }
  }

  quote(x: any): string | Error {
    if (typeof x === "string") {
      return "\"" + x.replace(/\"/g, "\\\"") + "\"";
    } else if (typeof x !== "object") {
      return JSON.stringify(x);
    } else if (Array.isArray(x)) {
      return JSON.stringify(x
        .filter((item) => typeof item !== "object")
      );
    } else {
      return new Error("query variable must be a primitive, or an array of primitives");
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}
