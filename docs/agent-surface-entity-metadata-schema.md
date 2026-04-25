# Agent Surface Entity Metadata JSON Schema

This schema describes the entity metadata format accepted by `services/agent-surface.ts` for exposed JSON Schema documents.

The runtime also verifies that field references in `x-agent` and `x-ui` point to keys declared in the entity schema's `properties` object. That cross-reference is data-dependent and is not represented in this generic JSON Schema.

For discovery on a particular surface, `x-expose.<surface>` must be `true`.

`x-agent.name` is the public discovery name for the entity. Agent surface
summary and detail responses expose this value as `name`; they do not emit a
duplicate `id` field.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://restspace.io/schemas/agent-surface/entity-metadata.schema.json",
  "title": "Agent Surface Entity Metadata",
  "description": "Metadata-bearing JSON Schema document for an entity exposed through the agent surface.",
  "type": "object",
  "required": ["type", "properties", "x-agent", "x-expose"],
  "properties": {
    "$id": {
      "type": "string"
    },
    "type": {
      "const": "object"
    },
    "title": {
      "type": "string",
      "minLength": 1
    },
    "properties": {
      "type": "object"
    },
    "required": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "x-ui": {
      "type": "object",
      "properties": {
        "primaryField": {
          "type": "string"
        },
        "subtitleFields": {
          "$ref": "#/$defs/fieldList"
        },
        "defaultListFields": {
          "$ref": "#/$defs/fieldList"
        }
      },
      "additionalProperties": true
    },
    "x-agent": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "entityName": {
          "type": "string",
          "minLength": 1
        },
        "entityNamePlural": {
          "type": "string",
          "minLength": 1
        },
        "summaryFields": {
          "$ref": "#/$defs/fieldList"
        },
        "searchableFields": {
          "$ref": "#/$defs/fieldList"
        },
        "filterableFields": {
          "$ref": "#/$defs/fieldList"
        },
        "identityHints": {
          "$ref": "#/$defs/fieldList"
        },
        "summarizableFields": {
          "$ref": "#/$defs/fieldList"
        }
      },
      "additionalProperties": true
    },
    "x-policy": {
      "type": "object",
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
    "fieldList": {
      "type": "array",
      "items": {
        "type": "string"
      }
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

Warning-free entity metadata should also include:

- `title`
- `x-agent.entityName`
- non-empty `x-agent.summaryFields`
- non-empty `x-agent.searchableFields`
- non-empty `x-agent.filterableFields`
- `x-render`
