import { ObjectId } from "mongodb";
import { resolveMongoDNS } from "https://deno.land/x/resolve_mongo_dns/mod.ts";

export interface MongoDbConnectionProps {
  /** MongoDB connection URI. Supports mongodb:// and mongodb+srv:// */
  url: string;
  /** Single database name to use for all operations. */
  dbName: string;
  /** Optional path to a CA bundle (commonly needed for Amazon DocumentDB TLS). */
  tlsCAFile?: string;
  /** Optional server selection timeout in ms (defaults to 2000). */
  serverSelectionTimeoutMS?: number;
  /** Optional connect timeout in ms (defaults to 2000). */
  connectTimeoutMS?: number;
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

export interface MongoAggregateQuery {
  collection: string;
  pipeline: Record<string, unknown>[];
  options?: Record<string, unknown>;
  from?: number;
  size?: number;
}

export class QueryFormatError extends Error {}

function parsePagingNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new QueryFormatError(`If provided, "${name}" must be a non-negative integer`);
  }
  return value;
}

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

  const from = parsePagingNumber(rec.from, "from");
  const size = parsePagingNumber(rec.size, "size");

  return {
    collection,
    pipeline: pipeline as Record<string, unknown>[],
    options: options as Record<string, unknown> | undefined,
    from,
    size,
  };
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

/**
 * Checks if an object is the $ignore marker { "$ignore": true }
 */
export function isIgnoreMarker(obj: unknown): boolean {
  return (
    obj !== null &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.keys(obj).length === 1 &&
    (obj as Record<string, unknown>)["$ignore"] === true
  );
}

function processIgnoreValue(value: unknown): unknown {
  if (isIgnoreMarker(value)) {
    return undefined; // Signal removal
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const processed = processIgnoreValue(item);
      if (processed !== undefined) {
        // Skip empty objects in arrays (from cleaned $and/$or children)
        if (typeof processed === "object" && processed !== null &&
            !Array.isArray(processed) && Object.keys(processed).length === 0) {
          continue;
        }
        result.push(processed);
      }
    }
    return result;
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      const processed = processIgnoreValue(val);

      if (processed === undefined) continue; // Remove this field

      // Remove empty $and/$or/$in/$all/$nin arrays
      if ((key === "$and" || key === "$or" || key === "$in" || key === "$all" || key === "$nin") &&
          Array.isArray(processed) && processed.length === 0) {
        continue;
      }

      // Remove non-operator fields with empty object values (e.g. { "tags": {} } after $in was removed)
      // Keep operator keys like $match, $lookup etc. with empty values
      if (!key.startsWith("$") &&
          typeof processed === "object" && processed !== null &&
          !Array.isArray(processed) && Object.keys(processed).length === 0) {
        continue;
      }

      // Remove orphaned $options (only meaningful with $regex)
      if (typeof processed === "object" && processed !== null && !Array.isArray(processed)) {
        const keys = Object.keys(processed);
        if (keys.length === 1 && keys[0] === "$options") {
          continue;
        }
      }

      result[key] = processed;
    }
    return result;
  }

  return value; // Primitives unchanged
}

/**
 * Recursively removes $ignore markers from pipeline.
 * - Fields with $ignore value are removed
 * - Empty $and/$or arrays are removed
 * - Empty $match stages are kept
 */
export function cleanIgnoreMarkers(
  pipeline: Record<string, unknown>[]
): Record<string, unknown>[] {
  return processIgnoreValue(pipeline) as Record<string, unknown>[];
}
