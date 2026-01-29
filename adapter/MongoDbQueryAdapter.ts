import { AdapterContext, contextLoggerArgs } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { Db, MongoClient } from "mongodb";
import {
  cleanIgnoreMarkers,
  MongoDbConnectionProps,
  mongoErrorToHttpStatus,
  isMongoTransientError,
  normalizeCollectionName,
  parseAggregateQuery,
  QueryFormatError,
  resolveMongoUrl,
  withFastRetry,
} from "./mongoDbCommon.ts";

export interface MongoDbQueryAdapterProps extends MongoDbConnectionProps {
  /** When true, empty string variables produce $ignore markers that remove the containing field */
  ignoreEmptyVariables?: boolean;
}

const mongoFirstStageOperators = new Set(["$geoNear", "$search", "$searchMeta", "$vectorSearch"]);

function isSafeMongoFieldPath(fieldPath: string): boolean {
  if (!fieldPath) return false;
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(fieldPath)) return false;
  return true;
}

function isSafeDataFieldValue(value: unknown): value is string | number | boolean {
  if (value === null || value === undefined) return false;
  const valueType = typeof value;
  return valueType === "string" || valueType === "number" || valueType === "boolean";
}

function parseDataFieldRules(roleSpec: string): Array<{ dataField: string; userField: string }> {
  return roleSpec.trim().split(" ")
    .filter((r) => r.startsWith("${") && r.endsWith("}") && r.includes("="))
    .map((r) => {
      const inner = r.slice(2, -1);
      const eqIdx = inner.indexOf("=");
      return {
        dataField: inner.slice(0, eqIdx),
        userField: inner.slice(eqIdx + 1),
      };
    });
}

function getDataFieldFiltersFromUser(
  roleSpec: string,
  userObj: unknown,
): Array<{ dataFieldName: string; userFieldValue: string | number | boolean }> | null {
  const rules = parseDataFieldRules(roleSpec);
  if (rules.length === 0) return [];
  if (!userObj || typeof userObj !== "object" || Array.isArray(userObj)) return null;

  const userRec = userObj as Record<string, unknown>;
  const filters: Array<{ dataFieldName: string; userFieldValue: string | number | boolean }> = [];
  for (const rule of rules) {
    const userVal = userRec[rule.userField];
    if (!isSafeDataFieldValue(userVal)) return null;
    filters.push({ dataFieldName: rule.dataField, userFieldValue: userVal });
  }
  return filters;
}

export default class MongoDbQueryAdapter implements IQueryAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(public context: AdapterContext, public props: MongoDbQueryAdapterProps) {
    this.quote = this.quote.bind(this);
  }

  private async ensureConnection() {
    if (this.db) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    const connectPromise = (async () => {
      const resolvedUrl = await resolveMongoUrl(this.props.url);

      const options: any = {
        serverSelectionTimeoutMS: this.props.serverSelectionTimeoutMS ?? 2000,
        connectTimeoutMS: this.props.connectTimeoutMS ?? 2000,
      };
      if (this.props.tlsCAFile) options.tlsCAFile = this.props.tlsCAFile;

      this.client = new MongoClient(resolvedUrl, options);
      await this.client.connect();
      this.db = this.client.db(this.props.dbName);
    })();

    this.connectPromise = connectPromise;
    try {
      await connectPromise;
    } catch (err) {
      try {
        await this.client?.close();
      } catch {
        // ignore close errors during failed connect
      }
      this.client = null;
      this.db = null;
      throw err;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  async runQuery(
    query: string,
    _variables: Record<string, unknown>,
    take = 1000,
    skip = 0,
  ): Promise<number | Record<string, unknown>[] | { items: Record<string, unknown>[]; total: number }> {
    try {
      await this.ensureConnection();
    } catch (error) {
      this.context.logger.error(
        `MongoDB connect error: ${error}`,
        ...contextLoggerArgs(this.context),
      );
      return mongoErrorToHttpStatus(error);
    }

    // Data-field authorization: enforce ${dataField=userField} rules from context.access.readRoles
    // by injecting a $match stage into the aggregate pipeline (Mongo only).
    const roleSpec = this.context.access?.readRoles || "";
    const hasDataFieldRules = parseDataFieldRules(roleSpec).length > 0;

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

    let pipelineStages = parsed.pipeline;
    if (this.props.ignoreEmptyVariables) {
      pipelineStages = cleanIgnoreMarkers(pipelineStages);
    }

    if (hasDataFieldRules) {
      const filters = getDataFieldFiltersFromUser(roleSpec, this.context.userObj);
      if (!filters) {
        // Fail closed, and avoid leaking whether the query would have returned results.
        return 404;
      }

      for (const f of filters) {
        if (!isSafeMongoFieldPath(f.dataFieldName)) {
          this.context.logger.error(
            `Unsafe data-field rule for MongoDB query: ${f.dataFieldName}`,
            ...contextLoggerArgs(this.context),
          );
          return 500;
        }
      }

      const matchExpr: Record<string, unknown> = filters.length === 1
        ? { [filters[0].dataFieldName]: filters[0].userFieldValue }
        : { $and: filters.map((f) => ({ [f.dataFieldName]: f.userFieldValue })) };

      const pipeline = pipelineStages.slice();
      const firstStage = pipeline[0];
      const firstKey = firstStage && typeof firstStage === "object" ? Object.keys(firstStage)[0] : undefined;
      const insertAt = firstKey && mongoFirstStageOperators.has(firstKey) ? 1 : 0;
      pipeline.splice(insertAt, 0, { $match: matchExpr });
      pipelineStages = pipeline;
    }

    const collection = normalizeCollectionName(parsed.collection);
    const hasPagingParams = parsed.from !== undefined || parsed.size !== undefined;
    let pipeline = pipelineStages;

    if (hasPagingParams) {
      const from = parsed.from ?? skip;
      const size = parsed.size ?? take;
      pipeline = pipelineStages.concat([
        {
          $facet: {
            items: [
              { $skip: from },
              { $limit: size },
            ],
            total: [
              { $count: "count" },
            ],
          },
        },
        {
          $project: {
            items: 1,
            total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },
          },
        },
      ]);
    }

    try {
      const coll = this.db?.collection(collection);
      if (!coll) throw new Error("Database not connected");

      return await withFastRetry(
        async () => {
          const cursor = coll.aggregate(pipeline as any, (parsed.options || {}) as any);
          const rows = await cursor.toArray();
          if (!hasPagingParams) {
            return rows as unknown as Record<string, unknown>[];
          }
          const first = rows[0] as Record<string, unknown> | undefined;
          const items = Array.isArray(first?.items) ? (first?.items as Record<string, unknown>[]) : [];
          const total = typeof first?.total === "number" ? first.total as number : 0;
          return { items, total };
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
      if (this.props?.ignoreEmptyVariables && x === "") {
        return '{ "$ignore": true }';
      }
      return "\"" + x.replace(/\"/g, "\\\"") + "\"";
    } else if (typeof x !== "object") {
      return JSON.stringify(x);
    } else if (Array.isArray(x)) {
      let filtered = x.filter((item) => typeof item !== "object");
      if (this.props?.ignoreEmptyVariables) {
        filtered = filtered.filter((item) => item !== "");
        if (filtered.length === 0) {
          return '{ "$ignore": true }';
        }
      }
      return JSON.stringify(filtered);
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
