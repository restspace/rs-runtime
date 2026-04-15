import { assert, assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import type { LogRecord } from "std/log/logger.ts";
import { resetForwarder } from "../services/logCollector.ts";

config.server = testServerConfig;

testServicesConfig['logcollector'] = JSON.parse(`{
    "services": {
        "/lib": {
            "name": "Lib",
            "source": "./services/lib.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/logs": {
            "name": "Log Collector",
            "source": "./services/logCollector.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        }
    }
}`);

// Forwarding config with batchSize=1 (flush immediately) and a long timer so the timer never fires during tests
testServicesConfig['logcollectorfwd'] = JSON.parse(`{
    "services": {
        "/lib": {
            "name": "Lib",
            "source": "./services/lib.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/logs": {
            "name": "Log Collector",
            "source": "./services/logCollector.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "forwardUrl": "https://collector.example.com/v1/logs",
            "forwardBatchSize": 1,
            "forwardFlushIntervalMs": 300000
        }
    }
}`);

testServicesConfig['logcollectorotlp'] = JSON.parse(`{
    "services": {
        "/lib": {
            "name": "Lib",
            "source": "./services/lib.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/logs": {
            "name": "Log Collector",
            "source": "./services/logCollector.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "forwardUrl": "https://otel.example.com/v1/logs",
            "forwardBatchSize": 1,
            "forwardFlushIntervalMs": 300000,
            "forwardFormat": "otlp"
        }
    }
}`);

const { testMessage } = utilsForHost("logcollector");
const { testMessage: testMessageFwd } = utilsForHost("logcollectorfwd");
const { testMessage: testMessageOtlp } = utilsForHost("logcollectorotlp");

/** Temporarily push a spy onto the global logger's handler list to capture LogRecords. */
function captureLog(): { records: LogRecord[]; restore: () => void } {
    const records: LogRecord[] = [];
    const spy = { handle: (r: LogRecord) => records.push(r) };
    (config.logger.handlers as unknown[]).push(spy);
    return {
        records,
        restore() {
            const idx = (config.logger.handlers as unknown[]).indexOf(spy);
            if (idx >= 0) config.logger.handlers.splice(idx, 1);
        }
    };
}

/** Replace globalThis.fetch for the duration of the test. */
function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): () => void {
    const orig = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => handler(input.toString(), init);
    return () => { globalThis.fetch = orig; };
}

// ── Basic functionality ──────────────────────────────────────────────────────

Deno.test("POST single entry returns 204", async () => {
    const msg = testMessage("/logs", "POST");
    msg.setDataJson({ level: "info", message: "hello from frontend" });
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 204);
});

Deno.test("POST single entry is written to logger with correct level and source", async () => {
    const { records, restore } = captureLog();
    try {
        const msg = testMessage("/logs", "POST");
        msg.setDataJson({ level: "warning", message: "frontend-warn-abc", source: "MyPage" });
        await handleIncomingRequest(msg);

        const rec = records.find(r => r.msg.includes("frontend-warn-abc"));
        assert(rec !== undefined, "log record not found in captured output");
        assertEquals(rec!.levelName, "WARNING");
        assertEquals(rec!.args[0], "logcollector"); // tenant
        assertEquals(rec!.args[1], "MyPage");        // source → service slot
        assertEquals(rec!.args[2], "?");             // no authenticated user
    } finally {
        restore();
    }
});

Deno.test("POST uses 'frontend' as default source when none provided", async () => {
    const { records, restore } = captureLog();
    try {
        const msg = testMessage("/logs", "POST");
        msg.setDataJson({ level: "info", message: "no-source-xyz" });
        await handleIncomingRequest(msg);

        const rec = records.find(r => r.msg.includes("no-source-xyz"));
        assert(rec !== undefined, "log record not found");
        assertEquals(rec!.args[1], "frontend");
    } finally {
        restore();
    }
});

Deno.test("POST entry with context appends JSON to log message", async () => {
    const { records, restore } = captureLog();
    try {
        const msg = testMessage("/logs", "POST");
        msg.setDataJson({ level: "info", message: "ctx-test-click", context: { button: "submit", page: "/home" } });
        await handleIncomingRequest(msg);

        const rec = records.find(r => r.msg.includes("ctx-test-click"));
        assert(rec !== undefined, "log record not found");
        assertStringIncludes(rec!.msg, '"button":"submit"');
        assertStringIncludes(rec!.msg, '"page":"/home"');
    } finally {
        restore();
    }
});

// ── Traceparent propagation ──────────────────────────────────────────────────

Deno.test("POST uses traceparent from entry body for log correlation", async () => {
    const { records, restore } = captureLog();
    try {
        const traceId = "a".repeat(32);
        const spanId  = "b".repeat(16);
        const msg = testMessage("/logs", "POST");
        msg.setDataJson({
            level: "info",
            message: "trace-body-xyz",
            traceparent: `00-${traceId}-${spanId}-01`
        });
        await handleIncomingRequest(msg);

        const rec = records.find(r => r.msg.includes("trace-body-xyz"));
        assert(rec !== undefined, "log record not found");
        assertEquals(rec!.args[3], traceId);
        assertEquals(rec!.args[4], spanId);
    } finally {
        restore();
    }
});

Deno.test("POST falls back to request traceparent header when entry has none", async () => {
    const { records, restore } = captureLog();
    try {
        const traceId = "c".repeat(32);
        const spanId  = "d".repeat(16);
        const msg = testMessage("/logs", "POST");
        msg.setHeader("traceparent", `00-${traceId}-${spanId}-01`);
        msg.setDataJson({ level: "info", message: "trace-header-xyz" });
        await handleIncomingRequest(msg);

        const rec = records.find(r => r.msg.includes("trace-header-xyz"));
        assert(rec !== undefined, "log record not found");
        assertEquals(rec!.args[3], traceId);
        assertEquals(rec!.args[4], spanId);
    } finally {
        restore();
    }
});

// ── Error handling ───────────────────────────────────────────────────────────

Deno.test("POST invalid level returns 400", async () => {
    const msg = testMessage("/logs", "POST");
    msg.setDataJson({ level: "verbose", message: "bad level" });
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 400);
});

Deno.test("POST missing message field returns 400", async () => {
    const msg = testMessage("/logs", "POST");
    msg.setDataJson({ level: "info" });
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 400);
});

Deno.test("POST with no body returns 400", async () => {
    const msg = testMessage("/logs", "POST");
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 400);
});

// ── Batch endpoint ───────────────────────────────────────────────────────────

Deno.test("POST /batch with valid entries returns 204", async () => {
    const msg = testMessage("/logs/batch", "POST");
    msg.setDataJson([
        { level: "info",  message: "batch-valid-a" },
        { level: "error", message: "batch-valid-b" },
        { level: "debug", message: "batch-valid-c" }
    ]);
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 204);
});

Deno.test("POST /batch writes all entries to logger", async () => {
    const { records, restore } = captureLog();
    try {
        const msg = testMessage("/logs/batch", "POST");
        msg.setDataJson([
            { level: "info",  message: "batch-write-111", source: "CompA" },
            { level: "error", message: "batch-write-222", source: "CompB" }
        ]);
        await handleIncomingRequest(msg);

        const recA = records.find(r => r.msg.includes("batch-write-111"));
        const recB = records.find(r => r.msg.includes("batch-write-222"));
        assert(recA !== undefined, "first batch record not found");
        assert(recB !== undefined, "second batch record not found");
        assertEquals(recA!.levelName, "INFO");
        assertEquals(recB!.levelName, "ERROR");
        assertEquals(recA!.args[1], "CompA");
        assertEquals(recB!.args[1], "CompB");
    } finally {
        restore();
    }
});

Deno.test("POST /batch writes entries in event timestamp order", async () => {
    const { records, restore } = captureLog();
    try {
        const msg = testMessage("/logs/batch", "POST");
        const early = "2026-04-15T10:00:00.000Z";
        const middle = "2026-04-15T10:00:01.000Z";
        const late = "2026-04-15T10:00:02.000Z";
        msg.setDataJson([
            { level: "info", message: "batch-sort-late", timestamp: late },
            { level: "info", message: "batch-sort-early", timestamp: early },
            { level: "info", message: "batch-sort-middle", timestamp: middle }
        ]);
        await handleIncomingRequest(msg);

        const sortedRecords = records.filter(r => r.msg.includes("batch-sort-"));
        assertEquals(sortedRecords.map(r => r.msg), [
            "batch-sort-early",
            "batch-sort-middle",
            "batch-sort-late"
        ]);
        assertEquals(sortedRecords.map(r => r.args[5]), [early, middle, late]);
    } finally {
        restore();
    }
});

Deno.test("POST /batch with non-array body returns 400", async () => {
    const msg = testMessage("/logs/batch", "POST");
    msg.setDataJson({ level: "info", message: "not an array" });
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 400);
});

Deno.test("POST /batch with empty array returns 204", async () => {
    const msg = testMessage("/logs/batch", "POST");
    msg.setDataJson([]);
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 204);
});

Deno.test("POST /batch with an invalid entry returns 400 with entry index", async () => {
    const msg = testMessage("/logs/batch", "POST");
    msg.setDataJson([
        { level: "info",  message: "ok entry" },
        { level: "bogus", message: "bad level here" }
    ]);
    const out = await handleIncomingRequest(msg);
    assertEquals(out.status, 400);
    const body = await out.data?.asString();
    assertStringIncludes(body ?? "", "[1]");
});

// ── External forwarding ──────────────────────────────────────────────────────

Deno.test("POST forwards log entry as JSON batch to forwardUrl", async () => {
    let capturedUrl: string | null = null;
    let capturedBody: string | null = null;
    const restoreFetch = mockFetch(async (url, init) => {
        capturedUrl = url;
        capturedBody = init?.body as string ?? null;
        return new Response("", { status: 200 });
    });
    try {
        const msg = testMessageFwd("/logs", "POST");
        msg.setDataJson({ level: "info", message: "fwd-json-xyz", source: "FrontPage" });
        await handleIncomingRequest(msg);
        // Give the async flush time to complete
        await new Promise(r => setTimeout(r, 100));

        assertEquals(capturedUrl, "https://collector.example.com/v1/logs");
        assert(capturedBody !== null, "fetch was never called — forward did not fire");
        const payload = JSON.parse(capturedBody!);
        assert(Array.isArray(payload), "json forward payload should be an array");
        assertEquals(payload[0].message, "fwd-json-xyz");
        assertEquals(payload[0].source, "FrontPage");
        assertEquals(payload[0].level, "info");
        assertEquals(payload[0].tenant, "logcollectorfwd");
    } finally {
        restoreFetch();
        resetForwarder();
    }
});

Deno.test("POST forwards OTLP envelope when forwardFormat is 'otlp'", async () => {
    let capturedBody: string | null = null;
    const restoreFetch = mockFetch(async (_url, init) => {
        capturedBody = init?.body as string ?? null;
        return new Response("", { status: 200 });
    });
    try {
        const msg = testMessageOtlp("/logs", "POST");
        msg.setDataJson({ level: "error", message: "otlp-test-xyz" });
        await handleIncomingRequest(msg);
        await new Promise(r => setTimeout(r, 100));

        assert(capturedBody !== null, "fetch was never called — OTLP forward did not fire");
        const payload = JSON.parse(capturedBody!);
        assert(payload.resourceLogs !== undefined, "OTLP payload missing resourceLogs");
        const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
        assertEquals(logRecord.body.stringValue, "otlp-test-xyz");
        assertEquals(logRecord.severityText, "ERROR");
        assertEquals(logRecord.severityNumber, 17);
    } finally {
        restoreFetch();
        resetForwarder();
    }
});
