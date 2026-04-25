# Agent Surface Pipeline Metadata JSON Schema

This schema describes the pipeline metadata format accepted by `services/agent-surface.ts` for exposed pipeline definitions.

The current discovery implementation only exposes pipelines with `x-policy.effect` set to `"read"`. A pipeline may declare `x-agent.kind` as either `"query"` or `"action"`, but non-read effects are excluded by this service.

For configured pipeline services, `inputSchema` and `outputSchema` may also be supplied through `manualMimeTypes.requestSchema` and `manualMimeTypes.responseSchema`; `agent-surface.ts` normalizes those into the metadata shape below.

For discovery on a particular surface, `x-expose.<surface>` must be `true`.

`x-agent.name` is the public discovery name for the pipeline or query. Agent
surface summary and detail responses expose this value as `name`; they do not
emit a duplicate `id` field.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://restspace.io/schemas/agent-surface/pipeline-metadata.schema.json",
  "title": "Agent Surface Pipeline Metadata",
  "description": "Metadata-bearing pipeline definition exposed through the agent surface.",
  "type": "object",
  "required": ["pipeline", "x-agent", "x-policy", "x-expose"],
  "properties": {
    "$id": {
      "type": "string"
    },
    "pipeline": {
      "$ref": "#/$defs/pipeline"
    },
    "inputSchema": {
      "type": "object"
    },
    "outputSchema": {
      "type": "object"
    },
    "x-ui": {
      "type": "object",
      "additionalProperties": true
    },
    "x-agent": {
      "type": "object",
      "required": ["name", "kind"],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "kind": {
          "enum": ["query", "action"]
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "type": "string",
          "minLength": 1
        },
        "resultShape": {
          "type": "string",
          "minLength": 1
        },
        "resultEntity": {
          "type": "string",
          "minLength": 1
        },
        "targetsEntity": {
          "type": "string",
          "minLength": 1
        },
        "suggestedUtterances": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": true
    },
    "x-policy": {
      "type": "object",
      "required": ["effect"],
      "properties": {
        "effect": {
          "const": "read"
        },
        "requiresConfirmation": {
          "type": "boolean"
        },
        "undoable": {
          "type": "boolean"
        },
        "externalSideEffect": {
          "type": "boolean"
        }
      },
      "additionalProperties": true
    },
    "x-render": {
      "type": "object",
      "additionalProperties": true
    },
    "x-context": {
      "type": "object",
      "additionalProperties": true
    },
    "x-expose": {
      "$ref": "#/$defs/exposure"
    }
  },
  "additionalProperties": true,
  "$defs": {
    "pipeline": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/pipelineStep"
      }
    },
    "pipelineStep": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "$ref": "#/$defs/pipeline"
        },
        {
          "type": "object"
        }
      ]
    },
    "exposure": {
      "type": "object",
      "properties": {
        "ui": {
          "type": "boolean"
        },
        "cli": {
          "type": "boolean"
        },
        "mcp": {
          "type": "boolean"
        },
        "endUser": {
          "type": "boolean"
        },
        "builder": {
          "type": "boolean"
        },
        "ops": {
          "type": "boolean"
        }
      },
      "additionalProperties": true,
      "anyOf": [
        {
          "required": ["ui"],
          "properties": {
            "ui": {
              "const": true
            }
          }
        },
        {
          "required": ["cli"],
          "properties": {
            "cli": {
              "const": true
            }
          }
        },
        {
          "required": ["mcp"],
          "properties": {
            "mcp": {
              "const": true
            }
          }
        },
        {
          "required": ["endUser"],
          "properties": {
            "endUser": {
              "const": true
            }
          }
        },
        {
          "required": ["builder"],
          "properties": {
            "builder": {
              "const": true
            }
          }
        },
        {
          "required": ["ops"],
          "properties": {
            "ops": {
              "const": true
            }
          }
        }
      ]
    }
  }
}
```

Warning-free pipeline metadata should also include:

- `x-agent.title`
- `x-agent.description`
- `outputSchema`
- non-empty `x-agent.suggestedUtterances`
- `x-agent.resultShape`
