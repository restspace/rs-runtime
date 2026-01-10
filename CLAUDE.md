# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Restspace Runtime is a multi-tenant web application platform built on Deno. It provides CMS, integration, backend-as-a-service, and low-code capabilities. The system is based on composable **service components** mounted at URL paths, with **pipelines** for chaining services together and **adapters** for pluggable infrastructure access.

## Common Commands

```bash
# Run the server (port 3100 by default)
npm run run

# Run with debug inspector
npm run run-debug

# Run without type checking (faster startup)
npm run run-nocheck

# Type check only
npm run check

# Run all tests (cleans test data first)
npm run test

# Run a single test file
deno test --unstable --allow-all test/<filename>.test.ts

# Bundle for production
npm run bundle
```

Tests require a clean test data directory at `C:\Dev\test\test-data` (Windows-specific path in package.json).

## Architecture

### Core Request Flow

1. `server.ts` - HTTP server entrypoint, creates `Message` from request
2. `handleRequest.ts` - `handleIncomingRequest()` routes to tenant
3. `tenant.ts` - Lazy-loads tenant configuration, calls `getMessageFunctionByUrl()`
4. `ServiceFactory.ts` - Matches URL to configured service, creates adapter and context
5. `ServiceWrapper.ts` - Wraps service with pre/post processing, auth, CORS, caching

### Key Abstractions

- **Service** (`rs-core/Service.ts`): Register handlers by HTTP method and subpath. Handlers receive `(msg, context, config)` and return a `Message`.
- **Message** (`rs-core/Message.ts`): HTTP request/response wrapper with `setStatus()`, `setDataJson()`, `setHeader()`, etc.
- **MessageBody** (`rs-core/MessageBody.ts`): Body wrapper with `asJson()`, `asString()`, `asArrayBuffer()`.
- **Adapter**: Pluggable infrastructure connector with its own manifest (`.ram.json`).
- **Manifest** (`.rsm.json`/`.rsm.js`): Service metadata including `moduleUrl`, `apis`, `configSchema`, `adapterInterface`, optional `prePipeline`/`postPipeline`.

### Directory Structure

- `services/` - Built-in service implementations (`.ts`) and manifests (`.rsm.json`/`.rsm.js`)
- `adapter/` - Adapter implementations for various backends (MongoDB, S3, Elasticsearch, etc.)
- `pipeline/` - Pipeline execution logic for composing services
- `auth/` - Authentication and authorization (`Authoriser.ts`)
- `test/` - Integration tests using mock server configuration

### Configuration

- `serverConfig.json` - Server-level config: tenancy mode, domain mapping, infras
- `services.json` (per tenant) - Service configurations mounted at URL paths
- `config.ts` - Runtime globals: `modules`, `tenants`, `logger`, validators

### Testing Pattern

Tests use `handleIncomingRequest()` directly with mock configurations:

```typescript
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { utilsForHost } from "./testUtility.ts";

testServicesConfig['mytenant'] = JSON.parse(`{ "services": { ... } }`);
const { testMessage, writeJson } = utilsForHost('mytenant');

Deno.test('my test', async () => {
  const msg = testMessage('/path', 'GET');
  const out = await handleIncomingRequest(msg);
  // assertions
});
```

## Dependencies

- `rs-core/` - Core library (sibling repo at `../rs-core/`)
- `std/` - Deno standard library
- Uses `deno.json` import map for module resolution

## Key Services

- `auth.ts` - Authentication with role system (A=admin, E=editor, U=user)
- `services.ts` - Tenant configuration management API
- `pipeline.ts` - Request chaining through multiple services with transforms
- `file.ts`, `data.ts`, `dataset.ts` - Data storage services
- `template.ts` - Template rendering (Nunjucks, JSX adapters)
- `proxy.ts` - External API proxying with auth forwarding

## Creating a New Service

1. Create `services/<name>.ts`:
   ```typescript
   import { Service } from "rs-core/Service.ts";
   const service = new Service();
   service.get((msg) => Promise.resolve(msg.setText('hello')));
   export default service;
   ```

2. Create `services/<name>.rsm.js` manifest with `name`, `description`, `moduleUrl`, `apis`.

See `RESTSPACE_SERVICE_GUIDE.md` for detailed service development patterns.
