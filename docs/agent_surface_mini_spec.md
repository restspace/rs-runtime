# Agent Surface Mini-Spec

## Status

Draft

## Purpose

This document defines a framework-level metadata and object model for exposing a generic agentic interface over applications built with the framework. The goal is to make agentic interaction available consistently through embedded web UI, CLI, and MCP, without requiring each application author to build a custom assistant layer.

The design assumes the framework already provides:

- JSON Schema for data stores
- stored query definitions
- pipelines as JSON objects
- services for storage, templating, and composition

This specification adds semantic metadata and a small number of supporting object types so those existing primitives can be projected into an agent-capable surface.

## Design Goals

The specification should:

- stay close to the framework's existing primitives
- avoid introducing a second parallel application model
- be generic across end-user UI, CLI, and MCP
- support both human-driven and LLM-driven interaction
- make actions inspectable, reviewable, and composable
- allow safe staged execution through proposals and plans
- permit structural metadata inference where practical

The specification should not:

- make chat the primary abstraction
- expose arbitrary CRUD as the default agent surface
- require application authors to hand-build a bespoke assistant UI

## Core Model

The agent surface is built from the following object families:

1. Entity schema
2. Query definition
3. Action definition
4. Proposal
5. Plan
6. Context object
7. Render definition
8. Discovery surface

These are not separate runtime subsystems. They are metadata-bearing projections of existing framework primitives.

## Metadata Namespaces

To keep extensions disciplined, metadata should be grouped into a small number of top-level extension blocks:

- `x-ui`
- `x-agent`
- `x-policy`
- `x-render`
- `x-context`
- `x-expose`

These should be preferred over scattering many unrelated extension keys across objects.

## Normative Language

The terms MUST, SHOULD, and MAY are used in their conventional specification sense.

## 1. Entity Schema

An entity schema is a JSON Schema document with semantic extensions describing how the framework should treat the underlying data as a user-facing entity.

### Requirements

An entity schema:

- MUST be valid JSON Schema
- MUST represent a user-facing noun in the application domain
- SHOULD declare summary and searchability metadata in `x-agent`
- SHOULD declare rendering hints in `x-render`
- MAY declare sensitivity hints in `x-policy`

### Recommended Fields

`x-ui` SHOULD be used for visual and listing hints, such as:

- icon
- primary field
- subtitle fields
- default list fields
- default sort

`x-agent` SHOULD be used for semantic hints, such as:

- entity name
- plural name
- summary fields
- searchable fields
- filterable fields
- identity hints
- summarizable fields
- selection label template

`x-policy` SHOULD be used for data sensitivity or access defaults.

`x-render` SHOULD define default result shape and template references.

`x-expose` SHOULD define which surfaces can discover the entity.

### Example

```json
{
  "$id": "app://schemas/contact",
  "type": "object",
  "title": "Contact",
  "properties": {
    "id": { "type": "string", "readOnly": true },
    "name": { "type": "string", "title": "Full name" },
    "email": { "type": "string", "format": "email" },
    "company": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string" },
    "lastContactedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["name"],
  "x-ui": {
    "icon": "contact",
    "primaryField": "name",
    "subtitleFields": ["email", "company"],
    "defaultListFields": ["name", "email", "company", "lastContactedAt"]
  },
  "x-agent": {
    "entityName": "contact",
    "entityNamePlural": "contacts",
    "summaryFields": ["name", "email", "company"],
    "searchableFields": ["name", "email", "company", "notes", "tags"],
    "filterableFields": ["company", "tags", "lastContactedAt"],
    "identityHints": ["email"],
    "summarizableFields": ["notes"]
  },
  "x-policy": {
    "sensitiveFields": ["notes"]
  },
  "x-render": {
    "defaultShape": "entity_card",
    "detailTemplate": "templates/contact/detail"
  },
  "x-expose": {
    "ui": true,
    "cli": true,
    "mcp": true
  }
}
```

## 2. Query Definition

A query definition is a stored query object plus semantic metadata describing how it should be discovered, invoked, and rendered.

### Requirements

A query definition:

- MUST declare executable query content
- SHOULD declare `inputSchema`
- SHOULD declare `outputSchema`
- MUST declare `x-agent.kind = "query"` if it is agent-exposed
- MUST have `x-policy.effect = "read"` if it is read-only

### Recommended Fields

`x-agent` SHOULD include:

- title
- description
- result entity
- result shape
- suggested utterances
- safety and determinism hints

`x-context` MAY declare injected context inputs.

`x-render` SHOULD define default render shape or template.

`x-expose` SHOULD declare which surfaces may discover the query.

### Example

```json
{
  "$id": "app://queries/stale-contacts",
  "store": "contacts",
  "query": {
    "where": {
      "lastContactedAt": { "$lt": "$inputs.before" }
    }
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "before": { "type": "string", "format": "date-time" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 50 }
    },
    "required": ["before"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": { "$ref": "app://schemas/contact" }
      }
    },
    "required": ["items"]
  },
  "x-agent": {
    "kind": "query",
    "title": "Stale contacts",
    "description": "Find contacts with no recent interaction before a cutoff date.",
    "resultEntity": "contact",
    "resultShape": "entity_list",
    "safe": true,
    "determinism": "deterministic"
  },
  "x-policy": {
    "effect": "read",
    "requiresConfirmation": false
  },
  "x-render": {
    "defaultShape": "table",
    "template": "templates/query/stale-contacts"
  },
  "x-expose": {
    "ui": true,
    "cli": true,
    "mcp": true,
    "endUser": true
  }
}
```

## 3. Action Definition

An action definition is a pipeline plus semantic metadata describing a meaningful operation over application state.

### Requirements

An action definition:

- MUST contain a pipeline or pipeline reference
- SHOULD declare input and output schemas
- MUST declare `x-agent.kind = "action"` if it is agent-exposed
- MUST declare an effect class in `x-policy.effect`
- SHOULD declare confirmation and reversibility semantics

### Effect Classes

The framework SHOULD standardize the following effect classes:

- `read`
- `local_mutation`
- `bulk_mutation`
- `external_effect`
- `proposal_only`

### Recommended Fields

`x-agent` SHOULD include:

- title
- description
- target entity
- result shape
- whether proposal mode is supported
- suggested utterances

`x-policy` SHOULD include:

- effect
- requires confirmation
- undoable
- external side effect flag
- maximum targets
- whether human review is recommended or required

### Example

```json
{
  "$id": "app://actions/contacts/merge",
  "pipeline": [
    { "use": "loadContactsById", "input": { "ids": "$inputs.sourceIds" } },
    { "use": "computeMergePreview", "input": { "resolution": "$inputs.resolution" } },
    { "use": "applyMerge", "input": { "resolution": "$inputs.resolution" } }
  ],
  "inputSchema": {
    "type": "object",
    "properties": {
      "sourceIds": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 2
      },
      "resolution": {
        "type": "object"
      }
    },
    "required": ["sourceIds", "resolution"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "mergedId": { "type": "string" },
      "mergedRecord": { "$ref": "app://schemas/contact" }
    },
    "required": ["mergedId", "mergedRecord"]
  },
  "x-agent": {
    "kind": "action",
    "title": "Merge contacts",
    "description": "Merge duplicate contact records into a single contact.",
    "targetsEntity": "contact",
    "resultShape": "entity",
    "supportsProposal": true
  },
  "x-policy": {
    "effect": "bulk_mutation",
    "requiresConfirmation": true,
    "undoable": true,
    "externalSideEffect": false,
    "maxTargets": 20,
    "humanReviewRecommended": true
  },
  "x-render": {
    "proposalPreviewTemplate": "templates/actions/merge-preview",
    "resultTemplate": "templates/actions/merge-result"
  },
  "x-expose": {
    "ui": true,
    "cli": true,
    "mcp": true,
    "endUser": true
  }
}
```

## 4. Proposal

A proposal is a stored invocation of an action, normally pending approval before execution.

### Requirements

A proposal:

- MUST reference an action definition
- MUST store the input payload that would be applied
- MUST have a status
- SHOULD support preview content
- SHOULD support preconditions to guard against stale application state

### Proposal Status Values

The framework SHOULD standardize the following status values:

- `pending`
- `approved`
- `applied`
- `rejected`
- `expired`
- `stale`
- `failed`

### Preconditions

Proposals SHOULD support preconditions such as:

- entity version matches
- action version matches
- permission checks
- context constraints

### Example

```json
{
  "$id": "app://proposals/p-001",
  "actionRef": "app://actions/contacts/merge",
  "input": {
    "sourceIds": ["c-12", "c-98"],
    "resolution": {
      "name": "Alice Carter",
      "email": "alice@example.com",
      "company": "Acme Ltd"
    }
  },
  "status": "pending",
  "createdAt": "2026-04-15T11:00:00Z",
  "expiresAt": "2026-04-15T15:00:00Z",
  "x-agent": {
    "kind": "proposal",
    "title": "Merge duplicate contacts",
    "resultShape": "proposal",
    "confidence": 0.94,
    "rationale": [
      "Matching email domain",
      "Highly similar names"
    ]
  },
  "x-policy": {
    "effect": "bulk_mutation",
    "requiresConfirmation": true,
    "undoable": true
  },
  "preconditions": {
    "ifMatchEntityVersions": {
      "c-12": "v18",
      "c-98": "v7"
    },
    "ifActionVersion": "a12"
  },
  "preview": {
    "shape": "merge_diff",
    "data": {
      "fieldChoices": {
        "name": { "chosen": "Alice Carter" }
      }
    }
  }
}
```

### Apply Semantics

When a proposal is applied, the runtime SHOULD:

1. resolve the referenced action
2. validate preconditions
3. execute the action with the stored input
4. persist trace and audit information
5. update proposal status accordingly

## 5. Plan

A plan is an ephemeral or persisted composition of queries, transforms, actions, and approval checkpoints. Conceptually it is a temporary pipeline with richer metadata and execution trace.

### Requirements

A plan:

- MUST define ordered or graph-structured steps
- MAY bind outputs of earlier steps into later steps
- MAY include explicit approval checkpoints
- SHOULD have a lifecycle status
- SHOULD be executable as a temporary pipeline or equivalent runtime graph

### Example

```json
{
  "$id": "app://plans/pl-001",
  "kind": "plan",
  "ephemeral": true,
  "status": "draft",
  "title": "Identify stale contacts and create reminders",
  "steps": [
    {
      "id": "s1",
      "type": "query",
      "ref": "app://queries/stale-contacts",
      "input": {
        "before": "2026-01-15T00:00:00Z",
        "limit": 100
      },
      "bindResultAs": "staleContacts"
    },
    {
      "id": "s2",
      "type": "approval",
      "title": "Approve reminder targets",
      "input": {
        "items": "$staleContacts.items"
      }
    },
    {
      "id": "s3",
      "type": "action",
      "ref": "app://actions/reminders/create-bulk",
      "input": {
        "contactIds": "$staleContacts.items[*].id",
        "reason": "Follow up with stale contact"
      }
    }
  ],
  "x-policy": {
    "effect": "bulk_mutation",
    "requiresConfirmation": true
  },
  "x-render": {
    "defaultShape": "task_list"
  }
}
```

## 6. Context Object

A context object stores transient session-scoped or workspace-scoped information that can be injected into queries, actions, proposals, or plans.

### Requirements

The framework SHOULD distinguish among:

- request context
- session context
- workspace or task context

A context object:

- MUST be addressable by session key or equivalent scope key
- SHOULD support typed fields for selection, filters, task state, and recent results
- SHOULD be readable through a standard service interface

### Example

```json
{
  "$id": "app://context/session/s-123",
  "sessionId": "s-123",
  "request": {
    "path": "/contacts",
    "method": "GET"
  },
  "ui": {
    "currentPage": "contacts.list",
    "selection": {
      "entityType": "contact",
      "ids": ["c-12", "c-98", "c-77"]
    },
    "filters": {
      "company": "Acme Ltd",
      "tag": "customer"
    }
  },
  "agent": {
    "currentTask": "deduplicate visible contacts",
    "draftProposalRef": "app://proposals/p-001"
  },
  "workspace": {
    "id": "w-55",
    "label": "Q2 outreach cleanup"
  }
}
```

### Context Injection

Definitions MAY declare context injections in `x-context`, for example:

```json
{
  "x-context": {
    "bind": {
      "selectedIds": "ui.selection.ids",
      "currentFilters": "ui.filters"
    }
  }
}
```

The runtime SHOULD resolve these bindings before execution.

## 7. Render Definition

Rendering is handled by the framework's template service. This specification standardizes how definitions describe result shapes and template selection.

### Standard Result Shapes

The framework SHOULD standardize at least the following result shapes:

- `scalar`
- `entity`
- `entity_list`
- `grouped_entity_list`
- `table`
- `card_list`
- `timeline`
- `document`
- `diff`
- `proposal`
- `warning_set`
- `task_list`

### Example

```json
{
  "$id": "app://renders/contact-list",
  "shape": "table",
  "template": "templates/contact/list",
  "fallbackShape": "plain_list",
  "variants": {
    "ui": {
      "template": "templates/contact/list-ui"
    },
    "cli": {
      "template": "templates/contact/list-cli"
    },
    "mcp": {
      "mode": "structured"
    }
  }
}
```

## 8. Discovery Surface

The framework SHOULD be able to synthesize a discovery document describing the currently exposed agent surface.

### Example

```json
{
  "$id": "app://agent-surface",
  "entities": [
    "app://schemas/contact",
    "app://schemas/company"
  ],
  "queries": [
    "app://queries/stale-contacts",
    "app://queries/contacts-by-company"
  ],
  "actions": [
    "app://actions/contacts/merge",
    "app://actions/reminders/create-bulk"
  ],
  "capabilities": {
    "supportsProposals": true,
    "supportsPlans": true,
    "supportsUndo": true,
    "supportsContextInjection": true
  }
}
```

Discovery SHOULD be filtered by `x-expose` and current permission context.

## 9. Inference Rules

The runtime MAY infer structural properties from schemas, queries, and pipeline topology.

### Suitable for Inference

The framework MAY infer:

- candidate input schema from declared bindings or first external inputs
- candidate output schema from final stage output
- candidate result shape from output schema
- context requirements from `$context.*` references
- referenced entity types from schema references
- possible mutating behavior from stage classes

### Not Suitable for Inference Alone

The framework SHOULD require explicit declaration for:

- user-facing title
- user-facing description
- confirmation requirement
- exposure to end-user, builder, CLI, or MCP surfaces
- external side effect classification
- preferred renderer
- autorun policy
- human review policy

A good implementation strategy is inferred structure plus declared semantics.

## 10. Policy

Policy metadata governs trust, review, and execution behavior.

### Recommended Policy Fields

`x-policy` SHOULD support at least:

- `effect`
- `requiresConfirmation`
- `undoable`
- `externalSideEffect`
- `humanReviewRequired`
- `maxTargets`
- `sensitivity`
- `autoRun`

### Example

```json
{
  "x-policy": {
    "effect": "read",
    "requiresConfirmation": false,
    "undoable": false,
    "externalSideEffect": false,
    "humanReviewRequired": false,
    "maxTargets": 100,
    "sensitivity": "normal",
    "autoRun": {
      "ui": false,
      "cli": false,
      "mcp": false
    }
  }
}
```

## 11. Exposure

Exposure metadata controls which surfaces may discover and invoke an object.

### Example

```json
{
  "x-expose": {
    "ui": true,
    "cli": true,
    "mcp": true,
    "endUser": true,
    "builder": false,
    "ops": false
  }
}
```

Objects SHOULD NOT be discoverable on a surface unless explicitly exposed there.

## 12. Surface Projections

The same agent surface SHOULD be projectable into web UI, CLI, and MCP.

### Embedded UI

The UI projection SHOULD support:

- context-aware discovery
- structured result rendering
- proposal review
- approval and rejection
- plan inspection
- undo where supported

### CLI

The CLI projection SHOULD support:

- command-oriented invocation of queries and actions
- proposal inspection and approval flows
- text rendering using `x-render` variants
- confirmation prompts driven by `x-policy`

Illustrative examples:

```bash
app query stale-contacts --before 2026-01-15T00:00:00Z
app action contacts/merge --input @merge.json
app proposal create app://actions/contacts/merge --input @merge.json
app proposal apply p-001
app plan run pl-001
```

### MCP

The MCP projection SHOULD expose:

- entities as discoverable structured resources or references
- queries and actions as tools
- proposals as staged operations with review semantics
- policy and effect metadata to allow external assistants to reason safely about invocation

## 13. Minimal Viable Adoption

An initial implementation MAY standardize only:

- entity schema extensions
- query metadata
- action metadata
- proposal objects
- context store

Plans, richer render definitions, and extended undo systems MAY be added later.

## 14. End-to-End Example Flow

In a contact management application:

1. the framework discovers an exposed query called `stale-contacts`
2. the user asks for contacts needing follow-up
3. the query runs and returns `entity_list`
4. the framework creates reminder proposals using an exposed action
5. the proposals are rendered as a reviewable task list or diff
6. approved proposals are applied through the stored action invocation

The same flow can be driven through web UI, CLI, or MCP with no bespoke assistant-specific logic beyond metadata and templates.

## 15. Summary

This specification defines a generic agent surface by extending existing framework primitives rather than replacing them.

The core idea is:

- entities are JSON Schemas with semantic metadata
- queries are stored queries with semantic metadata
- actions are pipelines with semantic metadata
- proposals are stored action invocations with preview and approval state
- plans are temporary or persisted compositions of queries and actions
- context is a session- or workspace-scoped object store
- rendering is selected through templates and result-shape metadata
- policy and exposure metadata govern safe projection into UI, CLI, and MCP

This yields a framework-native, surface-agnostic agentic interface with a small number of concepts and a strong fit to the framework's existing architecture.

