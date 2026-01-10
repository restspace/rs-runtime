import { ObjectId } from "mongodb";
import { resolveMongoDNS } from "https://deno.land/x/resolve_mongo_dns/mod.ts";

export interface MongoDbConnectionProps {
  /** MongoDB connection URI. Supports mongodb:// and mongodb+srv:// */
  url: string;
  /** Single database name to use for all operations. */
  dbName: string;
  /** Optional path to a CA bundle (commonly needed for Amazon DocumentDB TLS). */
  tlsCAFile?: string;
}

export async function resolveMongoUrl(url: string): Promise<string> {
  if (url.startsWith("mongodb+srv://")) {
    return await resolveMongoDNS(url);
  }
  return url;
}

export function parseId(key: string): ObjectId | string {
  // Allow string keys, but if it looks like an ObjectId, treat it as one.
  return ObjectId.isValid(key) && String(new ObjectId(key)) === key
    ? new ObjectId(key)
    : key;
}

export function normalizeCollectionName(dataset: string): string {
  if (dataset === "." || dataset === "..") throw new Error("Invalid collection name");
  // Keep names readable across MongoDB providers. Replace obviously problematic chars.
  return dataset.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export type AggregatePageMode = "appendStages" | "none";

export interface MongoAggregateQuery {
  collection: string;
  pipeline: Record<string, unknown>[];
  options?: Record<string, unknown>;
  page?: { mode?: AggregatePageMode };
}

export class QueryFormatError extends Error {}

export function parseAggregateQuery(obj: unknown): MongoAggregateQuery {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new QueryFormatError("Query must be a JSON object");
  }

  const rec = obj as Record<string, unknown>;
  const collection = rec.collection;
  const pipeline = rec.pipeline;

  if (typeof collection !== "string" || !collection) {
    throw new QueryFormatError('Query must include non-empty string field "collection"');
  }
  if (!Array.isArray(pipeline)) {
    throw new QueryFormatError('Query must include array field "pipeline"');
  }
  if (!pipeline.every((stage) => stage && typeof stage === "object" && !Array.isArray(stage))) {
    throw new QueryFormatError("Each pipeline stage must be an object");
  }

  const options = rec.options;
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) {
    throw new QueryFormatError('If provided, "options" must be an object');
  }

  const page = rec.page;
  if (page !== undefined && (!page || typeof page !== "object" || Array.isArray(page))) {
    throw new QueryFormatError('If provided, "page" must be an object');
  }

  return {
    collection,
    pipeline: pipeline as Record<string, unknown>[],
    options: options as Record<string, unknown> | undefined,
    page: page as { mode?: AggregatePageMode } | undefined,
  };
}

export function applyAggregatePaging(
  pipeline: Record<string, unknown>[],
  take: number,
  skip: number,
  mode: AggregatePageMode = "appendStages",
): Record<string, unknown>[] {
  if (mode === "none") return pipeline;

  const out = pipeline.slice();
  if (skip > 0) out.push({ $skip: skip });
  if (take > 0) out.push({ $limit: take });
  return out;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export interface FastRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withFastRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean,
  opts: FastRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 10;
  const maxDelayMs = opts.maxDelayMs ?? 100;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !shouldRetry(err)) throw err;

      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      // small jitter to avoid thundering herd
      const jitter = Math.floor(Math.random() * 10);
      await delay(backoff + jitter);
    }
  }
  throw lastErr;
}

export function isMongoDuplicateKeyError(err: unknown): boolean {
  const e: any = err as any;
  const code = e?.code;
  if (code === 11000) return true;
  const msg = String(e?.message || "");
  return msg.includes("E11000 duplicate key error");
}

export function isMongoTransientError(err: unknown): boolean {
  const e: any = err as any;

  // MongoDB driver sometimes provides error labels.
  const hasLabelFn = typeof e?.hasErrorLabel === "function";
  if (hasLabelFn) {
    if (e.hasErrorLabel("TransientTransactionError")) return true;
    if (e.hasErrorLabel("RetryableWriteError")) return true;
  }
  const labels: unknown = e?.errorLabels;
  if (Array.isArray(labels)) {
    if (labels.includes("TransientTransactionError")) return true;
    if (labels.includes("RetryableWriteError")) return true;
  }

  const code = e?.code;
  // Common server-side write conflict code.
  if (code === 112) return true;

  const name = String(e?.name || "");
  if (name.includes("MongoNetworkError")) return true;
  if (name.includes("MongoServerSelectionError")) return true;

  const msg = String(e?.message || "");
  if (msg.includes("WriteConflict")) return true;
  if (msg.toLowerCase().includes("timed out")) return true;

  return false;
}

export function mongoErrorToHttpStatus(err: unknown): number {
  if (isMongoDuplicateKeyError(err)) return 409;
  if (isMongoTransientError(err)) return 503;
  return 500;
}
