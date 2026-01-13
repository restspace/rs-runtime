import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";

interface IWebhooksConfig extends IServiceConfig {
  // Concurrency limit for parallel dispatch
  concurrency?: number;
  // Number of retries per target on failure/timeouts (default 0)
  retryCount?: number;
}

// Utilities
const seenRegistrants = new Set<string>();
const seenKey = (tenant: string, dataset: string, id: string) => `${tenant}|${dataset}|${id}`;
const regsByDataset = new Map<string, { id: string; url: string; secret: string }[]>();
const dsKey = (tenant: string, dataset: string) => `${tenant}|${dataset}`;
const enc = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sha256Hex(s: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return toHex(digest);
}

async function hmacSha256Hex(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toHex(sig);
}

function normaliseEventToDataset(servicePath: string): string {
  // Map event path (like "orders/created") to a dataset name safe for typical IDataAdapter backends.
  // - trim slashes
  // - replace remaining slashes with '.'
  // - lower-case
  // - remove illegal characters except [a-z0-9._-]
  const trimmed = servicePath.replace(/^\/+|\/+$/g, "");
  const dotted = trimmed.replace(/\/+/, ".");
  const lower = dotted.toLowerCase();
  return lower.replace(/[^a-z0-9._-]/g, "-");
}

function nowEpochSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

// Concurrency limiter
function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return async function<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((res) => queue.push(res));
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

/* Removed: direct fetch is not permitted; use context.makeRequest instead */
// async function fetchWithTimeout(msg: Message, timeoutMs: number): Promise<Message> {}

const service = new Service<IAdapter, IWebhooksConfig>();

// Single POST handler: register at root ('/'), dispatch at '/<event...>'
service.post(async (msg, context: ServiceContext<IAdapter>, config: IWebhooksConfig) => {
  const isRegistration = msg.url.servicePathElements.length === 0;

  if (isRegistration) {
    if (!msg.hasData()) return msg.setStatus(400, "Missing registration body");
    const body = await msg.data!.asJson() as any;
    const eventPath: string = (body?.event || "").toString();
    const url: string = (body?.url || "").toString();
    const secret: string = (body?.secret || "").toString();

    if (!eventPath || !url || !secret) {
      return msg.setStatus(400, "Fields 'event', 'url', and 'secret' are required");
    }
    if (!eventPath.startsWith("/")) {
      return msg.setStatus(400, "'event' must be a service-relative path starting with '/'");
    }

    const dataset = normaliseEventToDataset(eventPath.replace(/^\//, ""));
    const registrantId = await sha256Hex(url.toLowerCase());

    // In-memory fast duplicate guard (per-process)
    if (seenRegistrants.has(seenKey(msg.tenant, dataset, registrantId))) {
      return msg.setStatus(409, "Registrant already exists for this event (duplicate url)");
    }

    // Duplicate detection via private store listing (directory) and key probe
    const queryStr = msg.url.queryString ? `?${msg.url.queryString}` : '';
    const listMsg = new Message(`/*store/${dataset}/${queryStr}`, msg.tenant, 'GET', msg);
    const list = await context.makeRequest(listMsg);
    if (list.ok) {
      const dir = (await list.data?.asJson()) as { paths?: (string | string[])[] } | undefined;
      const entries = (dir?.paths || []).map((p) => Array.isArray(p) ? p[0] : p) as string[];
      if (entries.includes(`${registrantId}.json`)) {
        return msg.setStatus(409, "Registrant already exists for this event (duplicate url)");
      }
    }
    const probeMsg = new Message(`/*store/${dataset}/${registrantId}${queryStr}`, msg.tenant, "GET", msg);
    const probe = await context.makeRequest(probeMsg);
    if (probe.ok) {
      return msg.setStatus(409, "Registrant already exists for this event (duplicate url)");
    }

    const registrant = {
      id: registrantId,
      url,
      secret,
      createdAt: new Date().toISOString(),
    };

    // Write via private store directly so we can reliably detect create vs overwrite
    const writeMsg = new Message(`/*store/${dataset}/${registrantId}${queryStr}`, msg.tenant, 'PUT', msg).setDataJson(registrant);
    const write = await context.makeRequest(writeMsg);
    if (!write.ok) return write;
    if (write.status === 200) {
      return msg.setStatus(409, "Registrant already exists for this event (duplicate url)");
    }

  // Record in-memory for fast duplicate detection and quick dispatch lookup
  const mapKey = dsKey(msg.tenant, dataset);
  seenRegistrants.add(seenKey(msg.tenant, dataset, registrantId));
  const arr = regsByDataset.get(mapKey) || [];
  arr.push({ id: registrantId, url, secret });
  regsByDataset.set(mapKey, arr);

  // Return 201 with simple JSON (avoid leaking internal store paths)
  return msg
      .setHeader("Location", `/${config.basePath || ""}${msg.url.servicePath || ""}`)
      .setDataJson({ id: registrantId, event: eventPath, url })
      .setStatus(201);
  }

  // Dispatch branch: Derive dataset name for this event
  const eventPath = "/" + msg.url.servicePath;
  const dataset = normaliseEventToDataset(msg.url.servicePath);

  // Prefer in-memory registry if present for this dataset
  const mapKey = dsKey(msg.tenant, dataset);
  let registrants: { id: string; url: string; secret: string }[] | undefined = regsByDataset.get(mapKey);

  if (!registrants || registrants.length === 0) {
    // Fallback to store listing and reads
    const queryStr = msg.url.queryString ? `?${msg.url.queryString}` : '';
    const listStar = new Message(`/*store/${dataset}/${queryStr}`, msg.tenant, 'GET', msg);
    const listResp = await context.makeRequest(listStar);
    if (!listResp.ok) {
      // No registrants returns empty listing for many adapters; if explicit 404, treat as empty
      if (listResp.status !== 404) return listResp;
    }
    const dir = (await listResp.data?.asJson()) as { paths?: (string | string[])[] } | undefined;
    const entries = (dir?.paths || [])
      .map((p) => Array.isArray(p) ? p[0] : p)
      .filter((name) => typeof name === 'string') as string[];
    const registrantKeys = entries.filter((f) => f !== ".schema.json");

    registrants = [];
    for (const key of registrantKeys) {
      const getStar = new Message(`/*store/${dataset}/${key}${queryStr}`, msg.tenant, 'GET', msg);
      const r = await context.makeRequest(getStar);
      if (r.ok) {
        const obj = await r.data!.asJson();
        if (obj && typeof obj === 'object' && obj.url && obj.secret) {
          registrants.push({ id: (obj.id || key), url: obj.url, secret: obj.secret });
        }
      }
    }
  }
  registrants = registrants || [];
  // Deduplicate by URL (case-insensitive)
  const seen = new Set<string>();
  const uniqueRegistrants = registrants.filter((r) => {
    const k = r.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Prepare common signing inputs
  const timestamp = nowEpochSeconds();
  const bodyString = (await msg.data?.asString()) || "";
  const contentType = msg.getHeader('content-type') || 'application/json';
  const traceparent = context.traceparent;
  const tracestate = context.tracestate;

  // Dispatch in parallel with limit and timeout/retries
  const limit = pLimit(Math.max(1, config.concurrency || 8));
  const retries = Math.max(0, config.retryCount || 0);

  const results = await Promise.all(uniqueRegistrants.map((r) => limit(async () => {
    const deliveryId = crypto.randomUUID();
    let attempt = 0;
    let lastStatus = 0;
    let ok = false;
    let durationMs = 0;

    while (attempt <= retries && !ok) {
      const start = Date.now();
      const sig = await hmacSha256Hex(r.secret, `${timestamp}.${bodyString}`);
      const outMsg = new Message(r.url, msg.tenant, "POST", msg);
      outMsg.data = msg.data ? msg.data.copy() : undefined;
      outMsg.setHeader('content-type', contentType);
      outMsg.setHeader('X-Webhook-Event', eventPath);
      outMsg.setHeader('X-Webhook-Timestamp', timestamp);
      outMsg.setHeader('X-Webhook-Delivery-Id', deliveryId);
      outMsg.setHeader('X-Webhook-Signature', `sha256=${sig}`);
      outMsg.setHeader('X-Restspace-Event', eventPath);
      outMsg.setHeader('X-Restspace-Tenant', msg.tenant);
      if (traceparent) outMsg.setHeader('traceparent', traceparent);
      if (tracestate) outMsg.setHeader('tracestate', tracestate);

      const resp = await context.makeRequest(outMsg);
      durationMs = Date.now() - start;
      lastStatus = resp.status || (resp.ok ? 200 : 500);
      ok = resp.ok;
      if (!ok) attempt++;
    }

    return { id: r.id, url: r.url, status: lastStatus, ok, attempts: attempt || 1, durationMs };
  })));

  return msg
    .setDataJson({ event: eventPath, count: results.length, results })
    .setStatus(202);
});

export default service;