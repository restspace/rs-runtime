# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project overview

This is the Restspace Runtime, a Deno-based, multi-tenant HTTP runtime that loads “service components” and “adapters” via JSON manifests. The server lazily loads tenant configuration (services.json) from a configured store, routes requests by longest base-path match, wraps services with pre/post pipelines, applies CORS and caching, and supports internal request composition without network hops.

Common commands (pwsh-friendly)

- Run (local rs-core via importMap.json)
```powershell path=null start=null
deno run --allow-all --unstable --import-map=importMap.json server.ts ./serverConfig.json [port] [LOG_LEVEL]
# Examples:
# deno run --allow-all --unstable --import-map=importMap.json server.ts ./serverConfig.json 3100 INFO
# Debug inspector:
# deno run --inspect-brk --allow-all --unstable --import-map=importMap.json server.ts ./serverConfig.json 3100 DEBUG
```

- Run using hosted core (no local ../rs-core checkout)
```powershell path=null start=null
deno run --allow-all --unstable --import-map=importMapLib.json server.ts ./serverConfig.json 3100 INFO
```

- Type-check, lint, format
```powershell path=null start=null
# Type-check the entrypoint (uses import map via server.ts deps)
deno check --allow-import --unstable server.ts
# Lint all files
deno lint
# Format all files
deno fmt
# Refresh dependency cache
deno cache --import-map=importMap.json server.ts --reload
```

- Tests
```powershell path=null start=null
# Run all tests (uses test/ utilities and local file-backed test config)
deno test --unstable --allow-all test/
# Debug tests
deno test --inspect-brk --unstable --allow-all test/
# Run a single test file
deno test --unstable --allow-all test/pipeline.test.ts
# Filter by test name pattern
# (runs tests whose names match the regex)
deno test --unstable --allow-all --filter "pipeline"
# Optional: reset local test data (destructive)
# This clears C:\Dev\test\test-data used by tests
# Use with care and only if that path is safe to remove on your machine.
Remove-Item -Recurse -Force C:\Dev\test\test-data; New-Item -ItemType Directory C:\Dev\test\test-data | Out-Null
```

- Bundle for production and run from bundle
```powershell path=null start=null
# Produce bundled.js using esbuild with Deno loader (see bundle.ts)
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --allow-import bundle.ts
# Optional Windows-specific post-step (fix-bundle)
./fix-bundle.ps1
# Run the bundle
deno run --allow-all --unsafely-ignore-certificate-errors=restspace.local bundled.js ./serverConfig.json 3100 INFO
```

Key configuration and environment

- serverConfig.json controls tenancy, domains, infra, and storage backends.
  - tenancy: "single" | "multi"
  - mainDomain and domainMap: map hostnames to tenant names (used for routing)
  - infra: named adapter presets; configStore/stateStore select which infra to use
  - CORS setter is attached at runtime via getServerConfig.ts
- Import maps:
  - importMap.json maps "rs-core/" to a local sibling checkout at ../rs-core
  - importMapLib.json maps "rs-core/" to the hosted library at https://lib.restspace.io/core/
- Logging: configured in config.ts (RotatingFileHandler to ./main.log); pass LOG_LEVEL (e.g., DEBUG, INFO) as the 3rd CLI arg to server.ts

High-level architecture

- Entry and serving
  - server.ts parses args: serverConfig path, port (default 3100), log level; initializes logging and starts Deno.serve
  - WebSocket upgrades are handled; otherwise request is converted to Message and dispatched

- Request handling and routing
  - handleRequest.ts resolves tenant from Host header (tenantFromHostname)
  - getTenant lazily loads tenant if missing:
    - Uses config.modules.getConfigAdapter to read services.json from the configured configStore infra
    - Builds a Tenant (tenant.ts) and initializes services
  - For each request, ServiceFactory.getMessageFunctionByUrl selects the service by longest base-path match and returns a MessageFunction

- Tenants and configuration (tenant.ts)
  - Builds servicesConfig from raw services.json plus chords (composable config fragments)
  - Applies defaults and config templates from service manifests before initialization
  - Splits “local vs remote” sources to ensure local HTTP sources are ready first (readyBasePaths gating)
  - Attaches the auth service (if present) and uses it to set msg.user

- Manifests, services, and adapters
  - services/ contains built-in services; each has a manifest (*.rsm.js) and implementation (*.ts)
  - Adapters in adapter/ expose infrastructure and have manifests (*.ram.js)
  - ServiceFactory loads manifests, ensures adapter manifests exist for infra, and validates service/adapter configs using schemasafe validation (via Modules.defaultValidator)
  - Private services: manifests can declare privateServices; ServiceFactory synthesizes configs with basePath="<parent>/*<name>"

- Service wrapper and pipelines
  - ServiceWrapper wraps Service.func to run pre and post pipelines (merge of manifest and service config), apply redirects, and then execute
  - External calls: applies CORS, auth checks (AuthorizationType), and caching/ETag logic
  - MIME handlers (mimeHandlers.ts) post-process messages by content type (e.g., directory listings, zip aggregation)
  - Pipelines (pipeline/pipeline.ts) parse and execute declarative pipeline specs with steps, transforms, modes, and parallelization operators

- Modules and dynamic loading (Modules.ts)
  - Caches loaded services, adapters, and manifests keyed by canonical URLs
  - Statically wires core services/adapters, but can dynamically import additional modules from file or HTTP(S)
  - Validates manifests, generates per-source config validators from manifest schemas

- Internal vs external requests
  - Internal requests (Source.Internal/Outer) never hit the network; routing re-enters ServiceFactory and respects private services
  - External requests fall back to fetch unless overridden by config.requestExternal (used in tests)

- Testing approach (test/)
  - testServerConfig.ts sets a local disk-backed config store and test root path (C:\Dev\test\test-data\${tenant})
  - testUtility.ts constructs Message objects, calls handleIncomingRequest directly, and can intercept external requests via sysConfig.requestExternal

Important references

- README.md: overarching concepts and links to Restspace documentation, including the Technical Overview
- services/README.md: how to author services/adapters, manifest fields, handler API, and state management

Notes for future automation

- Prefer deno run with the appropriate import map for your setup (local core vs hosted core)
- Tests assume Windows-specific test data paths; do not remove or alter C:\Dev\test unless intentional
- Avoid remote deployment scripts that require local key paths; those are environment-specific and should not be run automatically
