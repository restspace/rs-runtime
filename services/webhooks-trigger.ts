import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { Url } from "rs-core/Url.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { pipeline } from "../pipeline/pipeline.ts";
import { BaseStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";

interface IWebhookTriggerSpec {
  // Event path to subscribe to, must match the server-side webhooks service
  // Example: "/order/created" (or any tenant-specific variant you use)
  event: string;
  // Shared secret used to sign and validate callbacks
  secret: string;
  // Optional: path or absolute URL of the webhooks service registration endpoint
  // Defaults to "/webhooks" (service-relative path in this tenant)
  webhooksPath?: string;
  // Optional: max allowed clock skew (seconds) when validating X-Webhook-Timestamp
  validateTimestampMaxSkewSec?: number;
  // Pipeline to execute when a validated webhook callback is received
  pipeline: PipelineSpec;
}

const service = new Service();

const enc = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");

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

function normaliseEventToDataset(eventPath: string): string {
  // Accepts leading slash or not; returns dataset-safe string similar to server mapping
  const trimmed = eventPath.replace(/^\/+|\/+$/g, "");
  const dotted = trimmed.replace(/\/+/, ".");
  const lower = dotted.toLowerCase();
  return lower.replace(/[^a-z0-9._-]/g, "-");
}

function isManageRequest(msg: Message) {
  return msg.url.isDirectory || (msg.getHeader('X-Restspace-Request-Mode') === 'manage');
}

async function readSpecWithContextUrl(msg: Message, context: any, config?: IServiceConfig): Promise<[IWebhookTriggerSpec, Url] | Message> {
  // Prefer reading directly from the configured backing store (avoids manage-mode forwarding pitfalls)
  const servicePathEls = msg.url.servicePathElements;
  if (servicePathEls.length !== 1) return msg.setStatus(400, 'Invalid callback url');
  const key = servicePathEls[0];

  const storeBasePath = (config as any)?.store?.adapterConfig?.basePath as string | undefined;
  if (storeBasePath) {
    const getSpec = new Message(`${storeBasePath}/${key}`, msg.tenant, 'GET', msg);
    const specResp = await context.makeRequest(getSpec);
    if (!specResp.ok) return specResp;
    const spec = await specResp.data?.asJson() as IWebhookTriggerSpec;
    if (!spec) return msg.setStatus(400, 'Missing subscription spec');
    // Context for pipeline: base it on the public callback path
    const contextUrl: Url = msg.url.copy();
    return [spec, contextUrl];
  }

  // Fallback to manage-mode GET (legacy)
  const getSpec = msg.copy().setMethod('GET').setHeader('X-Restspace-Request-Mode', 'manage');
  const specResp = await context.makeRequest(getSpec);
  if (!specResp.ok) return specResp;
  const spec = await specResp.data?.asJson() as IWebhookTriggerSpec;
  if (!spec) return msg.setStatus(400, 'Missing subscription spec');
  const contextUrl: Url = msg.url.copy();
  const location = specResp.getHeader('location');
  const locationUrl = location ? new Url(location).stripPrivateServices() : '';
  contextUrl.setSubpathFromUrl(locationUrl);
  return [spec, contextUrl];
}

async function registerWithWebhooks(spec: IWebhookTriggerSpec, callbackUrl: string, msg: Message, context: any) {
  const webhooksPath = spec.webhooksPath || "/webhooks";
  const regMsg = new Message(webhooksPath, msg.tenant, "POST", msg)
    .setDataJson({ event: spec.event, url: callbackUrl, secret: spec.secret });
  const regResp = await context.makeRequest(regMsg);
  // Consider 201 Created or 409 Conflict (already registered) as acceptable outcomes
  if (regResp.ok || regResp.status === 409) return;
  // If registration fails otherwise, log but don't fail the store write response
  context.logger.warning?.(`Webhook registration failed: ${regResp.status} ${await regResp.data?.asString()}`);
}

async function registerWithWebhooksDirect(context: SimpleServiceContext, spec: IWebhookTriggerSpec, callbackUrl: string) {
  const webhooksPath = spec.webhooksPath || "/webhooks";
  const regMsg = new Message(webhooksPath, context, "POST").setDataJson({ event: spec.event, url: callbackUrl, secret: spec.secret });
  const regResp = await context.makeRequest(regMsg);
  if (regResp.ok || regResp.status === 409) return;
  context.logger.warning?.(`Webhook registration (state) failed: ${regResp.status} ${await regResp.data?.asString()}`);
}

async function deregisterWithWebhooksDirect(context: SimpleServiceContext, spec: IWebhookTriggerSpec, callbackUrl: string) {
  // Only possible when webhooksPath is service-relative path in this tenant
  const webhooksPath = spec.webhooksPath || "/webhooks";
  if (!webhooksPath.startsWith('/')) return; // cannot manage private store of external service
  const dataset = normaliseEventToDataset(spec.event.replace(/^\//, ''));
  const registrantId = await sha256Hex(callbackUrl.toLowerCase());
  const delMsg = new Message(`${webhooksPath}/*store/${dataset}/${registrantId}`, context, "DELETE");
  const delResp = await context.makeRequest(delMsg);
  if (!delResp.ok && delResp.status !== 404) {
    context.logger.warning?.(`Webhook deregistration (state) failed: ${delResp.status} ${await delResp.data?.asString()}`);
  }
}

// Management writes (create/update specs) -> write to store then attempt registration
async function handleManageWrite(msg: Message, context: any, config?: IServiceConfig) {
  if (!msg.hasData()) return msg.setStatus(400, 'No data to write');
  // Read spec to validate
  const spec = await msg.data!.asJson() as IWebhookTriggerSpec;
  if (!spec || !spec.event || !spec.secret || !spec.pipeline) {
    return msg.setStatus(400, "Spec requires 'event', 'secret' and 'pipeline'");
  }

  // Compute public callback URL for this subscription (the resource URL itself)
  const callbackUrl = msg.url.toString();

  // Try to register first; tolerate duplicate (409)
  try {
    await registerWithWebhooks(spec, callbackUrl, msg, context);
  } catch {
    // best-effort registration; continue
  }

  // Persist spec directly to the configured backing store (bypass postPipeline)
  const servicePathEls = msg.url.servicePathElements;
  if (servicePathEls.length !== 1) return msg.setStatus(400, 'Invalid subscription path');
  const key = servicePathEls[0];

  const storeBasePath = (config as any)?.store?.adapterConfig?.basePath as string | undefined;
  if (!storeBasePath) {
    // If not configured, pass-through and hope manifest handles it
    msg.setDataJson(spec);
    return msg.setStatus(0);
  }

  const writeMsg = new Message(`${storeBasePath}/${key}`, msg.tenant, 'PUT', msg).setDataJson(spec);
  const writeResp = await context.makeRequest(writeMsg);
  if (!writeResp.ok) return writeResp;
  // Normalise Location to the public path (/subs/<key>)
  writeResp.setHeader('Location', msg.url.toString());
  return writeResp;
}

// Validate signature and execute pipeline on callback
async function handleCallback(msg: Message, context: any, config?: IServiceConfig) {
  const specResult = await readSpecWithContextUrl(msg, context, config);
  if (specResult instanceof Message) return specResult;
  const [spec, contextUrl] = specResult;

  // Extract required headers
  const timestamp = msg.getHeader('X-Webhook-Timestamp');
  const signature = msg.getHeader('X-Webhook-Signature');
  const eventHdr = msg.getHeader('X-Webhook-Event');
  if (!timestamp || !signature) return msg.setStatus(401, 'Missing signature headers');
  if (!eventHdr) return msg.setStatus(400, 'Missing X-Webhook-Event header');

  // Optional: ensure event matches spec
  if (spec.event && eventHdr !== spec.event) {
    return msg.setStatus(400, 'Event does not match subscription');
  }

  // Optional: timestamp skew check
  const skewMax = spec.validateTimestampMaxSkewSec || 0;
  if (skewMax > 0) {
    const ts = parseInt(timestamp, 10);
    if (!isNaN(ts)) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > skewMax) return msg.setStatus(401, 'Signature timestamp expired');
    }
  }

  // Verify HMAC signature (sha256=<hex>) with message body as string
  const bodyString = (await msg.data?.asString()) || "";
  const expected = await hmacSha256Hex(spec.secret, `${timestamp}.${bodyString}`);
  const got = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  if (got !== expected) return msg.setStatus(401, 'Bad signature');

  // Run pipeline
  const result = await pipeline(
    msg,
    spec.pipeline,
    contextUrl,
    false,
    (m: Message) => context.makeRequest(m),
    context.serviceName,
  );
  return result.setStatus(200);
}

class WebhooksTriggerState extends BaseStateClass {
  private _config?: IServiceConfig;

  private async listKeys(context: SimpleServiceContext, config: IServiceConfig): Promise<string[]> {
    const dirMsg = new Message(config.basePath + '/', context, 'GET').setHeader("X-Restspace-Request-Mode", "manage");
    const resp = await context.makeRequest(dirMsg);
    if (!resp.ok) return [];
    const json = await resp.data?.asJson();
    if (Array.isArray(json)) {
      return (json as string[]).filter((p) => typeof p === 'string' && !p.endsWith('/'));
    }
    if (json && typeof json === 'object' && Array.isArray(json.paths)) {
      const paths = (json.paths as (string | string[])[])
        .map((p) => Array.isArray(p) ? p[0] : p)
        .filter((p) => typeof p === 'string') as string[];
      return paths.filter((p) => !p.endsWith('/'));
    }
    return [];
  }

  private async readSpecForKey(context: SimpleServiceContext, config: IServiceConfig, key: string): Promise<IWebhookTriggerSpec | null> {
    const getMsg = new Message(config.basePath + '/' + key, context, 'GET').setHeader("X-Restspace-Request-Mode", "manage");
    const resp = await context.makeRequest(getMsg);
    if (!resp.ok) return null;
    try {
      const spec = await resp.data?.asJson() as IWebhookTriggerSpec;
      if (!spec || !spec.event || !spec.secret || !spec.pipeline) return null;
      return spec;
    } catch {
      return null;
    }
  }

  override async load(context: SimpleServiceContext, config: IServiceConfig): Promise<void> {
    this.context = context;
    this._config = config;
    // Defer registration to avoid re-entrant deadlock during tenant load (see timer-store.ts)
    // Fire-and-forget to let the service finish initializing first.
    (async () => {
      try {
        const keys = await this.listKeys(context, config);
        for (const key of keys) {
          const spec = await this.readSpecForKey(context, config, key);
          if (!spec) continue;
          const callbackUrl = config.basePath + '/' + key;
          // Best-effort cleanup then register
          await deregisterWithWebhooksDirect(context, spec, callbackUrl).catch(() => {});
          await registerWithWebhooksDirect(context, spec, callbackUrl).catch(() => {});
        }
      } catch (err) {
        context.logger.error?.('webhooks-trigger load error: ' + (err?.message || err));
      }
    })();
  }

  override async unload(_newState?: BaseStateClass | undefined): Promise<void> {
    const context = this.context as SimpleServiceContext;
    const config = this._config as IServiceConfig;
    if (!context || !config) return;
    try {
      const keys = await this.listKeys(context, config);
      for (const key of keys) {
        const spec = await this.readSpecForKey(context, config, key);
        if (!spec) continue;
        const callbackUrl = config.basePath + '/' + key;
        await deregisterWithWebhooksDirect(context, spec, callbackUrl).catch(() => {});
      }
    } catch (err) {
      context.logger.error?.('webhooks-trigger unload error: ' + (err?.message || err));
    }
  }
}

// Initialize state to (de)register subscriptions on startup/shutdown
service.initializer(async (context, config) => {
  await context.state(WebhooksTriggerState, context, config);
});

// GET directory or general store interactions (without our special handling)
service.getDirectory((msg) => msg.setStatus(0));

// Management GET: read spec from store (clients should pass X-Restspace-Request-Mode: manage)
service.get(async (msg) => {
  if (isManageRequest(msg)) return msg.setStatus(0);
  // If not manage, nothing to serve here (callbacks use POST)
  return msg.setStatus(404, 'Not found');
});

// Handle writes to spec in manage mode, otherwise treat POST as callback
service.post(async (msg, context, config) => {
  if (isManageRequest(msg)) return handleManageWrite(msg, context, config);
  return handleCallback(msg, context, config);
});

service.put(async (msg, context, config) => {
  if (isManageRequest(msg)) return handleManageWrite(msg, context, config);
  // No non-manage PUT semantics for callbacks
  return msg.setStatus(404, 'Not found');
});

// Pass delete through to store when in manage mode
service.delete(async (msg, _context) => {
  if (isManageRequest(msg)) return msg.setStatus(0);
  return msg.setStatus(404, 'Not found');
});

export default service;
