# Restspace CLI Tool for Agent Access - Design Plan

## Summary

Create an agent-first CLI tool (`rs`) in a **separate repository** that exposes Restspace functionality to LLM agents via **shell execution**. Includes **server-side enhancements** to rs-runtime for richer API discovery.

**CLI Command**: `rs` (short, quick to type)
**Invocation**: Shell/subprocess execution (compatible with any agent framework)

## Design Principles (Agent-First)

1. **Structured JSON output** - All commands return parseable JSON
2. **Self-describing** - Built-in explanations of concepts and patterns
3. **Discovery-centric** - Agents can learn what's available programmatically
4. **Error guidance** - Failed operations explain why and suggest fixes
5. **Explicit over implicit** - No hidden magic, predictable behavior
6. **Stateless operations** - Commands are idempotent where possible

---

## Part 1: CLI Tool (Separate Repository)

### Repository Structure
```
rs/
  src/
    commands/
      config.ts         # Config management
      auth.ts           # Login/logout
      discover.ts       # Discovery commands
      call.ts           # API calls
      pipeline.ts       # Pipeline operations
      query.ts          # Query operations
      help.ts           # Help system
    lib/
      api-client.ts     # HTTP client with auth
      output.ts         # JSON output formatting
      config-store.ts   # Config file management
    concepts/           # Built-in concept documentation
      services.json
      pipelines.json
      patterns.json
      queries.json
    main.ts
  deno.json
  README.md
```

### Configuration

**Config File** (`~/.restspace/config.json`):
```json
{
  "host": "https://mytenant.restspace.io",
  "credentials": {
    "email": "user@example.com",
    "password": "..."
  },
  "auth": {
    "token": "...",
    "expiry": 1234567890
  }
}
```

Password can alternatively be set via `RS_PASSWORD` environment variable.

### Command Structure

#### 1. Configuration & Auth
```bash
rs config init                    # Create config interactively
rs config set host <url>          # Set server URL
rs config set email <email>       # Set email
rs config show                    # Show config (masks password)

rs login                          # Authenticate, cache JWT
rs logout                         # Clear cached JWT
rs whoami                         # Current user info + token validity
```

#### 2. Discovery (Core for Agents)
```bash
rs discover                       # Full discovery output
rs discover services              # List all configured services
rs discover service <basePath>    # Details for one service
rs discover patterns              # Explain all API patterns
rs discover pattern <name>        # Explain specific pattern (store, transform, etc.)
rs discover concepts              # All concept explanations
rs discover concept <name>        # Specific concept (pipeline, query, etc.)
```

**Example: `rs discover services` output:**
```json
{
  "success": true,
  "services": [
    {
      "basePath": "/api/data",
      "name": "Data API",
      "source": "./services/data.ts",
      "pattern": "store",
      "patternDescription": "RESTful CRUD - supports GET, POST, PUT, DELETE",
      "access": { "readRoles": "all", "writeRoles": "U" },
      "methods": {
        "GET": { "description": "Read item at path", "example": "/api/data/users/123" },
        "POST": { "description": "Create/update item", "example": "/api/data/users/123" },
        "PUT": { "description": "Create/update item", "example": "/api/data/users/123" },
        "DELETE": { "description": "Delete item", "example": "/api/data/users/123" }
      }
    },
    {
      "basePath": "/templates",
      "name": "Templates",
      "source": "./services/template.ts",
      "pattern": "store-transform",
      "patternDescription": "Store templates, POST data to transform",
      "methods": {
        "GET": { "description": "Read template file" },
        "PUT": { "description": "Store template file" },
        "POST": { "description": "Render template with posted data" }
      }
    }
  ]
}
```

**Example: `rs discover pattern store` output:**
```json
{
  "success": true,
  "pattern": {
    "name": "store",
    "description": "A directory which allows resources to be dynamically created and deleted",
    "methods": {
      "GET": {
        "pathFormat": "/{basePath}/{key}",
        "description": "Read the resource at the given key",
        "responses": {
          "200": "Resource data returned",
          "404": "Resource not found"
        }
      },
      "POST": {
        "pathFormat": "/{basePath}/{key}",
        "description": "Create or update resource, returns the written data",
        "responses": { "200": "Updated", "201": "Created" }
      },
      "PUT": {
        "pathFormat": "/{basePath}/{key}",
        "description": "Create or update resource, returns the written data",
        "responses": { "200": "Updated", "201": "Created" }
      },
      "DELETE": {
        "pathFormat": "/{basePath}/{key}",
        "description": "Delete the resource",
        "responses": { "200": "Deleted", "404": "Not found" }
      }
    },
    "examples": [
      { "command": "rs call GET /api/data/users/123", "description": "Get user 123" },
      { "command": "rs call PUT /api/data/users/456 -d '{\"name\":\"Jane\"}'", "description": "Create user" }
    ]
  }
}
```

#### 3. API Calls
```bash
rs call <METHOD> <path> [options]
  -d, --data <json>           # Request body (JSON string)
  -f, --file <path>           # Read body from file
  -H, --header <key:value>    # Additional header
  -q, --query <key=value>     # Query parameter (repeatable)
  --timeout <ms>              # Request timeout
```

**Example output:**
```json
{
  "success": true,
  "status": 200,
  "headers": { "content-type": "application/json" },
  "data": { "id": 123, "name": "John" },
  "metadata": {
    "method": "GET",
    "path": "/api/data/users/123",
    "duration": 45
  }
}
```

**Error output:**
```json
{
  "success": false,
  "status": 404,
  "error": "Resource not found",
  "suggestion": "Check if the path exists. Use 'rs call GET /api/data/' to list available items.",
  "metadata": { ... }
}
```

#### 4. Pipeline Commands
```bash
rs pipeline list [store-path]     # List stored pipelines
rs pipeline get <path>            # Get pipeline spec
rs pipeline create <path> -d <spec>  # Create pipeline
rs pipeline execute <path> [-d data] # Execute pipeline
rs pipeline validate -d <spec>    # Validate syntax
rs pipeline explain               # Explain pipeline syntax
```

**Example: `rs pipeline explain` output (abbreviated):**
```json
{
  "success": true,
  "concept": "pipeline",
  "description": "A pipeline chains multiple service calls with data transformation",
  "syntax": {
    "step": {
      "format": "[try] [if (condition)] METHOD URL [:$variable]",
      "examples": [
        { "spec": "GET /api/users", "description": "Simple GET request" },
        { "spec": "try GET /api/users :$result", "description": "Capture result, don't fail on error" },
        { "spec": "if (status === 404) GET /api/default", "description": "Conditional execution" }
      ]
    },
    "transform": {
      "format": "{ key: \"expression\", ... }",
      "examples": [
        { "spec": "{ \"name\": \"user.name\" }", "description": "Extract nested property" }
      ]
    },
    "modes": {
      "serial": "Execute steps in sequence (default)",
      "parallel": "Execute sub-pipelines in parallel",
      "conditional": "Try mode - test and branch"
    },
    "variables": {
      "$_user": "Current authenticated user",
      "$_headers": "Request headers",
      "$name": "User-defined variable"
    }
  }
}
```

#### 5. Query Commands
```bash
rs query list [store-path]        # List stored queries
rs query get <path>               # Get query template
rs query create <path> -d <template>  # Create query
rs query execute <path> [-d params]   # Execute with parameters
rs query explain                  # Explain query syntax
```

#### 6. Help System
```bash
rs help                           # Overview
rs help <command>                 # Command help
rs help agent                     # Agent-specific quickstart
```

**Example: `rs help agent` output:**
```json
{
  "quickstart": {
    "step1": {
      "description": "Discover available services",
      "command": "rs discover services"
    },
    "step2": {
      "description": "Understand a service's API pattern",
      "command": "rs discover service <basePath>"
    },
    "step3": {
      "description": "Make API calls",
      "command": "rs call GET <path>"
    },
    "step4": {
      "description": "Create pipelines for complex workflows",
      "command": "rs pipeline create <path> -d '<spec>'"
    }
  },
  "tips": [
    "All commands return JSON - parse the 'success' field first",
    "Use 'discover' commands to learn the API before calling",
    "Error responses include 'suggestion' field with guidance",
    "Pipeline variables persist across steps - use :$var to capture results"
  ]
}
```

---

## Part 2: Server-Side Enhancements (rs-runtime)

### New Discovery Endpoint

Add to `services/services.ts`:

**`GET /.well-known/restspace/services/agent-discovery`**

Returns enriched discovery data optimized for agents:

```json
{
  "server": {
    "version": "1.0.0",
    "tenant": "mytenant"
  },
  "patterns": {
    "store": {
      "description": "RESTful CRUD directory",
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "pathFormat": "{basePath}/{key}",
      "keyDescription": "Resource identifier, can be multi-segment path"
    },
    "transform": {
      "description": "POST data transformation endpoint",
      "methods": ["POST"],
      "pathFormat": "{basePath}"
    },
    "store-transform": {
      "description": "Store + transform combined",
      "methods": ["GET", "PUT", "POST", "DELETE"],
      "getDescription": "Read stored item",
      "postDescription": "Transform data using stored item as template"
    },
    "view": {
      "description": "Read-only GET endpoint",
      "methods": ["GET"]
    },
    "operation": {
      "description": "Action endpoint, no response body",
      "methods": ["POST", "PUT"]
    },
    "directory": {
      "description": "Fixed URL structure",
      "methods": ["varies by endpoint"]
    }
  },
  "services": [
    {
      "basePath": "/api/data",
      "name": "Data API",
      "pattern": "store",
      "description": "Key-value data storage",
      "access": { "readRoles": "all", "writeRoles": "U" },
      "endpoints": [
        {
          "method": "GET",
          "path": "/api/data/{key}",
          "description": "Read data item",
          "example": { "path": "/api/data/users/123" }
        },
        {
          "method": "PUT",
          "path": "/api/data/{key}",
          "description": "Write data item",
          "example": {
            "path": "/api/data/users/123",
            "body": { "name": "John", "email": "john@example.com" }
          }
        }
      ]
    }
  ],
  "concepts": {
    "authentication": {
      "description": "JWT-based auth via rs-auth cookie or Authorization header",
      "loginEndpoint": "/auth/login",
      "loginMethod": "POST",
      "loginBody": { "email": "string", "password": "string" }
    },
    "pipelines": {
      "description": "Chain multiple API calls with transforms",
      "storePattern": "Pipeline specs stored as JSON files",
      "executePattern": "POST to pipeline endpoint with input data"
    },
    "queries": {
      "description": "Parameterized query templates",
      "storePattern": "Query templates stored as text files",
      "executePattern": "POST to query endpoint with parameters"
    }
  }
}
```

### Enhanced Pattern Documentation

Add to `openApi.ts` (or new file `patternDocs.ts`):

Generate comprehensive documentation for each API pattern with:
- Method descriptions
- Path formats
- Request/response schemas
- Example requests
- Common error codes

### Files to Modify in rs-runtime

1. **`services/services.ts`** - Add `agent-discovery` endpoint
2. **`openApi.ts`** - Enhance with all pattern types, not just store
3. **New: `agentDiscovery.ts`** - Helper functions for building discovery data

---

## Implementation Phases

### Phase 1: CLI Foundation
1. Set up separate Deno repository with project structure
2. Implement config management (`config init`, `config set`, `config show`)
3. Implement authentication (`login`, `logout`, `whoami`)
4. Implement basic `call` command
5. JSON output formatting with success/error structure

### Phase 2: Discovery System
6. Implement `discover services` using existing endpoint
7. Implement `discover patterns` with built-in pattern documentation
8. Implement `discover concepts` with built-in concept docs
9. Implement `discover service <path>` for single service details

### Phase 3: Server-Side Discovery
10. Add `agent-discovery` endpoint to `services/services.ts`
11. Enhance `openApi.ts` for all patterns
12. Update CLI to use enhanced discovery endpoint

### Phase 4: Pipelines & Queries
13. Implement `pipeline` commands (list, get, create, execute, explain)
14. Implement `query` commands (list, get, create, execute, explain)
15. Implement `pipeline validate` for syntax checking

### Phase 5: Polish
16. Implement full help system
17. Add error suggestions to all failure cases
18. Testing and documentation

---

## Verification Plan

1. **Auth flow**: `rs login` successfully authenticates and caches JWT
2. **Discovery**: `rs discover services` returns valid JSON listing all services
3. **API calls**: `rs call GET /api/data/test` returns expected data
4. **Pipeline execution**: Create and execute a simple pipeline
5. **Query execution**: Create and execute a parameterized query
6. **Error handling**: Invalid commands return helpful error messages with suggestions

---

## Technology Stack

- **Runtime**: Deno
- **CLI Framework**: Cliffy (https://cliffy.io/)
- **HTTP Client**: Deno fetch with custom wrapper for auth
- **Config Storage**: JSON file in `~/.restspace/`
- **Output**: JSON to stdout (can be piped to jq for formatting)

---

## Agent Integration Pattern

Agents invoke `rs` via shell execution. Typical workflow:

```
Agent: Execute shell command
> rs discover services

Agent receives JSON output:
{
  "success": true,
  "services": [...]
}

Agent parses JSON, decides next action:
> rs call GET /api/data/users/123

Agent receives response, continues workflow...
```

**Key design for shell execution:**
- All output goes to stdout as JSON
- Errors go to stderr with JSON structure
- Exit codes: 0 = success, non-zero = error
- No interactive prompts (all input via flags/args)
- Config file eliminates need to pass credentials each time

---

## Open Questions Resolved

- **Repository**: Separate repo (confirmed)
- **Audience**: Agent-first with JSON output (confirmed)
- **Profiles**: Single server per config (confirmed)
- **Server changes**: Yes, add discovery endpoint (confirmed)
