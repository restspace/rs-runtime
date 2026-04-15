import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

export interface ILogCollectorConfig extends IServiceConfig {
    forwardUrl?: string;
    forwardHeaders?: Record<string, string>;
    forwardBatchSize?: number;
    forwardFlushIntervalMs?: number;
    maxQueueSize?: number;
    forwardFormat?: "json" | "otlp";
}

interface LogEntry {
    level: "debug" | "info" | "warning" | "error" | "critical";
    message: string;
    source?: string;
    traceparent?: string;
    timestamp?: string;
    context?: Record<string, unknown>;
}

interface NormalisedEntry {
    level: "debug" | "info" | "warning" | "error" | "critical";
    message: string;
    source: string;
    tenant: string;
    username: string;
    traceId: string;
    spanId: string;
    timestamp: string;
    context?: Record<string, unknown>;
}

const VALID_LEVELS = new Set(["debug", "info", "warning", "error", "critical"]);
const LOG_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Module-level forwarding queue and timer
let queue: NormalisedEntry[] = [];
let flushTimer: number | null = null;
let activeForwardConfig: ILogCollectorConfig | null = null;

function parseTraceparent(traceparent: string | null | undefined): { traceId: string; spanId: string } {
    if (traceparent) {
        const parts = traceparent.split('-');
        if (parts.length >= 3 && parts[1].length === 32 && parts[2].length === 16) {
            return { traceId: parts[1], spanId: parts[2] };
        }
    }
    return { traceId: 'x'.repeat(32), spanId: 'x'.repeat(16) };
}

function validLogTimestamp(timestamp: unknown): string | undefined {
    return typeof timestamp === "string" && LOG_TIMESTAMP_PATTERN.test(timestamp)
        ? timestamp
        : undefined;
}

function compareTimestampStrings(a: string | undefined, b: string | undefined): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

function sortBatchByTimestamp(entries: LogEntry[]): LogEntry[] {
    return entries
        .map((entry, index) => ({ entry, index, timestamp: validLogTimestamp(entry.timestamp) }))
        .sort((a, b) => compareTimestampStrings(a.timestamp, b.timestamp) || a.index - b.index)
        .map(({ entry }) => entry);
}

function validateEntry(entry: unknown): string | null {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "Log entry must be an object";
    }
    const logEntry = entry as LogEntry;
    if (!VALID_LEVELS.has(logEntry.level)) {
        return `Invalid level '${logEntry.level}'. Must be one of: debug, info, warning, error, critical`;
    }
    if (!logEntry.message || typeof logEntry.message !== 'string') {
        return "Missing or invalid 'message' field";
    }
    return null;
}

function toOtlpSeverityNumber(level: string): number {
    switch (level) {
        case "debug": return 5;
        case "info": return 9;
        case "warning": return 13;
        case "error": return 17;
        case "critical": return 21;
        default: return 9;
    }
}

function buildOtlpPayload(entries: NormalisedEntry[], tenant: string): unknown {
    return {
        resourceLogs: [{
            resource: {
                attributes: [
                    { key: "service.name", value: { stringValue: "rs-runtime" } },
                    { key: "tenant", value: { stringValue: tenant } }
                ]
            },
            scopeLogs: [{
                scope: { name: "logCollector" },
                logRecords: entries.map(e => ({
                    timeUnixNano: String(new Date(e.timestamp).getTime() * 1_000_000),
                    severityNumber: toOtlpSeverityNumber(e.level),
                    severityText: e.level.toUpperCase(),
                    body: { stringValue: e.message },
                    traceId: e.traceId,
                    spanId: e.spanId,
                    attributes: [
                        { key: "source", value: { stringValue: e.source } },
                        { key: "username", value: { stringValue: e.username } },
                        ...(e.context ? Object.entries(e.context).map(([k, v]) => ({
                            key: k,
                            value: { stringValue: String(v) }
                        })) : [])
                    ]
                }))
            }]
        }]
    };
}

async function flushQueue(config: ILogCollectorConfig): Promise<void> {
    if (!config.forwardUrl || queue.length === 0) return;

    const batch = queue.splice(0, queue.length);
    const format = config.forwardFormat ?? "json";
    const tenant = batch[0]?.tenant ?? "unknown";

    const body = format === "otlp"
        ? JSON.stringify(buildOtlpPayload(batch, tenant))
        : JSON.stringify(batch);

    try {
        const resp = await fetch(config.forwardUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...config.forwardHeaders
            },
            body
        });
        if (!resp.ok) {
            // Put batch back at front of queue for one retry on next flush
            queue.unshift(...batch);
        }
    } catch {
        // On network error, silently discard to avoid unbounded growth
    }
}

function ensureFlushTimer(config: ILogCollectorConfig): void {
    if (!config.forwardUrl) return;
    const intervalMs = config.forwardFlushIntervalMs ?? 10000;
    if (flushTimer !== null && activeForwardConfig?.forwardFlushIntervalMs === config.forwardFlushIntervalMs) return;
    if (flushTimer !== null) clearInterval(flushTimer);
    flushTimer = setInterval(() => flushQueue(config), intervalMs);
    activeForwardConfig = config;
}

function enqueue(entry: NormalisedEntry, config: ILogCollectorConfig): void {
    const maxSize = config.maxQueueSize ?? 1000;
    if (queue.length >= maxSize) queue.shift(); // drop oldest
    queue.push(entry);

    const batchSize = config.forwardBatchSize ?? 50;
    if (queue.length >= batchSize) {
        flushQueue(config);
    }
}

function writeToLog(
    context: ServiceContext<never>,
    entry: LogEntry,
    requestTraceparent: string | undefined
): void {
    // Prefer traceparent on the entry itself (frontend passes its session traceparent),
    // fall back to the incoming POST request's traceparent
    const { traceId, spanId } = parseTraceparent(entry.traceparent ?? requestTraceparent);
    const source = entry.source || 'frontend';
    const tenant = context.tenant;
    const username = context.user || '?';

    const contextStr = entry.context
        ? ' ' + JSON.stringify(entry.context)
        : '';
    const message = entry.message + contextStr;
    const timestamp = validLogTimestamp(entry.timestamp);

    // Write via baseLogger with the entry's own trace context, not the POST request's
    const args = [message, tenant, source, username, traceId, spanId, timestamp] as const;
    switch (entry.level) {
        case "debug":    context.baseLogger.debug(...args);    break;
        case "info":     context.baseLogger.info(...args);     break;
        case "warning":  context.baseLogger.warning(...args);  break;
        case "error":    context.baseLogger.error(...args);    break;
        case "critical": context.baseLogger.critical(...args); break;
    }
}

function normalise(
    entry: LogEntry,
    context: ServiceContext<never>,
    requestTraceparent: string | undefined
): NormalisedEntry {
    const { traceId, spanId } = parseTraceparent(entry.traceparent ?? requestTraceparent);
    return {
        level: entry.level,
        message: entry.message,
        source: entry.source || 'frontend',
        tenant: context.tenant,
        username: context.user || '?',
        traceId,
        spanId,
        timestamp: entry.timestamp ?? new Date().toISOString(),
        context: entry.context
    };
}

function processEntry(
    entry: LogEntry,
    context: ServiceContext<never>,
    config: ILogCollectorConfig,
    requestTraceparent: string | undefined
): string | null {
    const error = validateEntry(entry);
    if (error) return error;

    writeToLog(context, entry, requestTraceparent);

    if (config.forwardUrl) {
        const norm = normalise(entry, context, requestTraceparent);
        enqueue(norm, config);
        ensureFlushTimer(config);
    }

    return null;
}

/** Clears the flush timer — used in tests to prevent interval leaks. */
export function resetForwarder(): void {
    if (flushTimer !== null) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    activeForwardConfig = null;
    queue.length = 0;
}

const service = new Service<never, ILogCollectorConfig>();

service.post(async (msg: Message, context: ServiceContext<never>, config: ILogCollectorConfig) => {
    if (!msg.hasData()) return msg.setStatus(400, "Missing request body");

    const body = await msg.data!.asJson() as LogEntry;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return msg.setStatus(400, "Body must be a single log entry object");
    }

    const requestTraceparent = msg.getHeader('traceparent') ?? undefined;
    const error = processEntry(body, context, config, requestTraceparent);
    if (error) return msg.setStatus(400, error);

    return msg.setData(null, '').setStatus(204);
});

service.postPath('batch', async (msg: Message, context: ServiceContext<never>, config: ILogCollectorConfig) => {
    if (!msg.hasData()) return msg.setStatus(400, "Missing request body");

    const body = await msg.data!.asJson();
    if (!Array.isArray(body)) return msg.setStatus(400, "Body must be an array of log entries");
    if (body.length === 0) return msg.setData(null, '').setStatus(204);

    const requestTraceparent = msg.getHeader('traceparent') ?? undefined;
    const errors: string[] = [];

    const entries = body as LogEntry[];
    for (let i = 0; i < entries.length; i++) {
        const error = validateEntry(entries[i]);
        if (error) errors.push(`[${i}] ${error}`);
    }

    if (errors.length > 0) {
        return msg.setStatus(400, errors.join('; '));
    }
    for (const entry of sortBatchByTimestamp(entries)) {
        processEntry(entry, context, config, requestTraceparent);
    }
    return msg.setData(null, '').setStatus(204);
});

export default service;
