export default {
    "name": "Log Collector",
    "description": "Accepts frontend/external log entries and writes them to the unified backend log, with optional forwarding to an external observability sink (OTEL Collector, Datadog, etc.)",
    "moduleUrl": "./services/logCollector.ts",
    "apis": [ "log.collector" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "forwardUrl": {
                "type": "string",
                "description": "HTTP endpoint to POST log batches to (e.g. OTEL Collector /v1/logs, Datadog /api/v2/logs). Omit to disable forwarding."
            },
            "forwardHeaders": {
                "type": "object",
                "description": "HTTP headers included in forward requests (e.g. { \"DD-API-KEY\": \"...\" })",
                "additionalProperties": { "type": "string" }
            },
            "forwardBatchSize": {
                "type": "number",
                "description": "Number of queued entries that triggers an immediate flush. Default: 50.",
                "default": 50
            },
            "forwardFlushIntervalMs": {
                "type": "number",
                "description": "Periodic flush interval in milliseconds. Default: 10000.",
                "default": 10000
            },
            "maxQueueSize": {
                "type": "number",
                "description": "Maximum in-memory queue size; oldest entries are dropped when exceeded. Default: 1000.",
                "default": 1000
            },
            "forwardFormat": {
                "type": "string",
                "enum": [ "json", "otlp" ],
                "description": "Payload format for the external sink. 'json' sends a plain JSON array; 'otlp' sends an OpenTelemetry Logs (OTLP/HTTP) envelope. Default: 'json'.",
                "default": "json"
            }
        }
    }
}
