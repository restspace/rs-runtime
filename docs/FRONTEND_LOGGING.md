# Frontend Logging with logCollector

The `logCollector` service accepts log entries from frontend applications and writes them into the same `main.log` as backend logs, using the same structured format including W3C distributed trace IDs. This means a single user operation produces a unified, correlated log trail across browser and server.

## How it works

The `logCollector` service exposes two endpoints:

- `POST /logs` — single log entry
- `POST /logs/batch` — array of log entries

Entries are written to `main.log` via the standard Deno logger. They appear alongside backend logs and are queryable via the existing `logReader` service (`GET /logs/json/200` groups entries by traceId and spanId).

Optionally, entries can be forwarded to an external observability sink (Datadog, Grafana Loki, OpenTelemetry Collector) by configuring `forwardUrl` in the service config — no code changes required.

## The tracing model

The W3C `traceparent` header has the format `00-{traceId}-{spanId}-01`:

- **traceId** (32 hex chars) — identifies one user-initiated operation, shared across all requests and log entries belonging to it
- **spanId** (16 hex chars) — identifies one specific unit of work within the trace; a new one is generated per API call

Create a new traceId per meaningful user action ("submit order", "run search", "save document") — not per page load and not per individual API call. Send `traceparent` as an **HTTP header** on every `fetch()` call, both to backend APIs and to `/logs/batch`. The backend automatically inherits the traceId and its own spans appear under the same trace group.

## Implementation

### 1. Trace utilities

```typescript
// lib/trace.ts

export function newTraceId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export function newSpanId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export function makeTraceparent(traceId: string): string {
  // Generate a fresh spanId for each call so spans are distinct within the trace
  return `00-${traceId}-${newSpanId()}-01`;
}
```

### 2. Log client

```typescript
// lib/log.ts

const LOG_URL = '/logs/batch';

let queue: object[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let currentTraceId: string | null = null;

export function setTraceId(id: string | null) {
  currentTraceId = id;
}

export function log(
  level: 'debug' | 'info' | 'warning' | 'error' | 'critical',
  message: string,
  context?: Record<string, unknown>
) {
  queue.push({
    level,
    message,
    source: 'react-app',
    timestamp: new Date().toISOString(),
    context,
  });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 2000);
}

async function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // The traceparent header is the primary mechanism — logCollector reads it and
  // writes the entry under the correct traceId in main.log
  if (currentTraceId) {
    headers['traceparent'] = makeTraceparent(currentTraceId);
  }
  await fetch(LOG_URL, { method: 'POST', headers, body: JSON.stringify(batch) })
    .catch(() => {}); // fire-and-forget; errors are silently dropped
}

// Flush immediately on page unload so buffered entries aren't lost
globalThis.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
```

### 3. React trace context

```tsx
// lib/TraceContext.tsx
import { createContext, useContext, useState, useCallback } from 'react';
import { newTraceId, makeTraceparent } from './trace';
import { setTraceId, log } from './log';

interface TraceContext {
  traceId: string | null;
  /** Start a new named operation. Returns the traceId. */
  startOperation: (name: string) => string;
  /** End the current operation. */
  endOperation: () => void;
  /** Returns a fresh traceparent header value for a fetch() call. */
  traceparent: () => string | null;
}

const Ctx = createContext<TraceContext | null>(null);

export function TraceProvider({ children }: { children: React.ReactNode }) {
  const [traceId, setLocalTraceId] = useState<string | null>(null);

  const startOperation = useCallback((name: string) => {
    const id = newTraceId();
    setLocalTraceId(id);
    setTraceId(id);
    log('info', `Operation started: ${name}`, { op: name });
    return id;
  }, []);

  const endOperation = useCallback(() => {
    setLocalTraceId(null);
    setTraceId(null);
  }, []);

  const traceparent = useCallback(() =>
    traceId ? makeTraceparent(traceId) : null
  , [traceId]);

  return (
    <Ctx.Provider value={{ traceId, startOperation, endOperation, traceparent }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTrace = () => useContext(Ctx)!;
```

### 4. Traced fetch wrapper

```typescript
// lib/tracedFetch.ts

export async function tracedFetch(
  url: string,
  init: RequestInit = {},
  traceparent: string | null
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (traceparent) headers.set('traceparent', traceparent);
  return fetch(url, { ...init, headers });
}
```

### 5. Usage in a component

```tsx
import { useTrace } from '../lib/TraceContext';
import { tracedFetch } from '../lib/tracedFetch';
import { log } from '../lib/log';

function SearchPage() {
  const { startOperation, endOperation, traceparent } = useTrace();

  async function handleSearch(query: string) {
    startOperation('search');
    try {
      const resp = await tracedFetch(
        `/api/search?q=${encodeURIComponent(query)}`,
        { method: 'GET' },
        traceparent() // new spanId per call, same traceId throughout
      );
      if (!resp.ok) {
        log('error', `Search failed: ${resp.status}`, { query, status: resp.status });
      }
    } catch (err) {
      log('error', `Search threw: ${String(err)}`, { query });
    } finally {
      endOperation();
    }
  }

  // ...
}
```

### 6. Wire up the provider

```tsx
// main.tsx
import { TraceProvider } from './lib/TraceContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <TraceProvider>
    <App />
  </TraceProvider>
);
```

## What you get in logReader

A single search operation produces correlated entries across browser and server. `GET /logReader/json/200` returns:

```json
{
  "a3f8b2...": {
    "fe1a2b3c4d5e6f70": [
      { "level": "INFO",  "message": "Operation started: search" },
      { "level": "ERROR", "message": "Search failed: 503", "context": "..." }
    ],
    "9c8d7e6f5a4b3210": [
      { "level": "INFO", "message": "(Incoming) Request GET /api/search" },
      { "level": "ERROR", "message": "Upstream timeout" }
    ]
  }
}
```

Frontend entries (first spanId) and backend entries (second spanId) appear under the **same traceId** because both the `POST /logs/batch` call and the `GET /api/search` call carried the same `traceparent` header.

## Mounting the service

In a tenant's `services.json`:

```json
"/logs": {
  "name": "Log Collector",
  "source": "./services/logCollector.rsm.json",
  "access": { "readRoles": "nobody", "writeRoles": "'all'" }
}
```

`writeRoles: "'all'"` allows unauthenticated frontends to post. `readRoles: "nobody"` prevents the endpoint being used to read anything.

## Scaling to an external sink

To forward logs to an external observability service, add forwarding config:

```json
"/logs": {
  "name": "Log Collector",
  "source": "./services/logCollector.rsm.json",
  "access": { "readRoles": "nobody", "writeRoles": "'all'" },
  "forwardUrl": "https://your-otel-collector/v1/logs",
  "forwardHeaders": { "Authorization": "Bearer your-token" },
  "forwardBatchSize": 50,
  "forwardFlushIntervalMs": 10000,
  "forwardFormat": "otlp"
}
```

`forwardFormat: "otlp"` sends an OpenTelemetry Logs envelope compatible with any OTLP/HTTP endpoint (Grafana Loki, Datadog, Honeycomb, etc.). `forwardFormat: "json"` sends a plain JSON array suitable for custom ingestion pipelines.

## Traceparent: header vs body field

The `logCollector` service reads traceparent from two places:

| Location | When to use |
|----------|-------------|
| `traceparent` **request header** | Standard case — set this on every `fetch()` call. logCollector reads it and writes the entry under the correct trace group. |
| `traceparent` **body field** | Use when logging something that happened under a *different* span than the current POST request — e.g. replaying a buffered entry from a previous session. The body field takes precedence over the header. |

For typical frontend logging, setting the header is sufficient. The body field is only needed for advanced cases like offline log replay.
