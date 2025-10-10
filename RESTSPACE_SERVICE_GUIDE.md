# Building a Restspace Service (Condensed Guide)

This guide distills how to implement a Restspace service and its manifest, using patterns from services/ and the rs-core APIs (Service, Message, MessageBody).

## TL;DR (Minimal service)

```ts path=null start=null
import { Service } from "rs-core/Service.ts";

const service = new Service();

service.get((msg) => Promise.resolve(msg.setText('hello world')));

export default service;
```

- Create a Service
- Register one or more handlers
- Export default service

## Anatomy of a Service

- Construct: `new Service<TAdapter, TConfig>()`
  - TAdapter: adapter interface (e.g., IDataAdapter) the service uses (optional)
  - TConfig: config type the service receives (extends IServiceConfig) (optional)

- Handler signature (ServiceFunction):
  - `(msg: Message, context: ServiceContext<TAdapter>, config: TConfig) => Message | Promise<Message>`

- Register handlers by method and optional subpath:
  - All requests: `all(func)`, `allPath(path, func)`
  - GET: `get(func)`, `getPath(path, func)`
  - GET directory (url ends with '/'): `getDirectory(func)`, `getDirectoryPath(path, func)`
  - POST: `post(func, schema?, mimeTypes?)`, `postPath(path, func, schema?, mimeTypes?)`
  - POST directory: `postDirectory(func)`, `postDirectoryPath(path, func)`
  - PUT: `put(func, schema?, mimeTypes?)`, `putPath(path, func, schema?, mimeTypes?)`
  - PUT directory: `putDirectory(func)`, `putDirectoryPath(path, func)`
  - DELETE: `delete(func)`, `deletePath(path, func)`
  - DELETE directory: `deleteDirectory(func)`, `deleteDirectoryPath(path, func)`
  - PATCH: `patch(func)`, `patchPath(path, func)`
  - OPTIONS: if needed, implement an options handler similarly (see proxy service)
  - Eager init: `initializer(async (context, config, oldState?) => { ... })`
  - Constant directory view: `constantDirectory(path, dirSpec)`

- URL segmentation (common pattern in handlers):
  - `msg.url.basePathElements`: segments for configured base path (+ any handler subpath)
  - `msg.url.servicePath`: remaining path after base path
  - `msg.url.servicePathElements`: array of servicePath segments
  - `msg.url.subPathElements`: optional “parameters” after a store item path for store-style services

- Authorization defaults and POST semantics:
  - `authType(msg)`: default maps GET/HEAD→read, POST→write (unless `postIsWrite=false`), others→write; override to customize
  - `service.postIsWrite = false` to make POST treated as read (e.g., template transformation)

- Validation (optional):
  - `post/put(..., schema?, mimeTypes?)` perform JSON schema validation (if `schema` given) and/or content-type checks

## Context essentials (ServiceContext)

Common fields/methods available to handlers:
- `tenant`: current tenant name
- `logger`: wrapped logger for request-scoped logs
- `manifest`: current service manifest
- `adapter`: instance of the typed adapter (if your service is `Service<TAdapter>`) constructed from config
- `getAdapter<T>(url, adapterConfig)`: dynamically load another adapter instance
- `makeRequest(msg)`: send an internal/ external request built from a Message
- `runPipeline(msg, pipelineSpec, contextUrl?)`: run a pipeline
- `makeProxyRequest(msg)`: available when `proxyAdapterSource` is set in manifest (proxies auth/headers)
- `state(StateClass, context, config)`: access or create a tenant-scoped state object (see State below)

## Message and MessageBody (working with requests/responses)

Message highlights:
- Build/modify response:
  - `setStatus(code, message?)`, `setText(text)`, `setData(data, mime)`, `setDataJson(obj)`, `setDirectoryJson(obj)`
  - `setHeader(name, value)`, `getHeader(name)`, `removeHeader(name)`
  - `redirect(url, isTemporary?)` (sets status and Location)
  - `copy()` (shares body), `copyWithData()` (tees streams)
- Read/derive:
  - `hasData()`, `getParam(name)`, `schema` (from `content-type` schema param)
  - Convert to/from fetch primitives when needed: `toRequest()`, `toResponse()`

MessageBody highlights:
- Construction: `MessageBody.fromString(str)`, `fromObject(obj)`, `fromRequest(req)`, `fromError(status, text)`
- Access/convert: `asJson()`, `asString()`, `asArrayBuffer()`, `asReadable()`
- Metadata: `.mimeType`, `.size`, `.dateModified`, `.filename`, `.setMimeType()`

## Adapters and typing

- Type your service for stronger contracts: `const service = new Service<IDataAdapter, MyConfig>();`
- Access the pre-configured adapter via `context.adapter`
- Build proxy messages with `context.makeProxyRequest(msg)` when your manifest sets `proxyAdapterSource`
- You can dynamically load additional adapters with `context.getAdapter<T>()`

Example (adapter-based GET/POST flow, simplified):
```ts path=null start=null
import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";

const service = new Service<IDataAdapter>();

service.get(async (msg, { adapter }) => {
  const [ dataset, key ] = msg.url.servicePathElements;
  const val = await adapter.readKey(dataset, key);
  if (typeof val === 'number') return msg.setStatus(val);
  return msg.setDataJson(val);
});

service.post(async (msg, { adapter }) => {
  const [ dataset, key ] = msg.url.servicePathElements;
  if (!msg.hasData()) return msg.setStatus(400, 'No data');
  const res = await adapter.writeKey(dataset, key, msg.data!.copy());
  return typeof res === 'number' && res >= 300 ? msg.setStatus(res) : msg.setStatus(200);
});

export default service;
```

## State management (optional)

- Define a class implementing `BaseStateClass` with async `load()` and `unload()`
- Eager load: use `service.initializer(async (context, config) => { await context.state(MyState, context, config); });`
- Lazy load: call `await context.state(MyState, context, config)` when first needed; runtime initializes once per tenant/config and reuses

```ts path=null start=null
service.initializer(async (context, config) => {
  await context.state(MyState, context, config);
});
```

## Directory endpoints and listings

- Directory handlers: `getDirectory(...)`, `getDirectoryPath(path, ...)`
- Emit directory JSON: `msg.setDirectoryJson({ path, paths, spec } /* DirDescriptor */)`
- To expose static directory entries derived from registered handlers: `service.pathsAt(path)` and/or `service.constantDirectory(path, dirSpec)`

## Manifests (.rsm.js)

A manifest is a JS module exporting a JSON-like object (default export). Typical fields:
- Required: `name`, `description`, `moduleUrl`, `apis`
- Common optional:
  - `configSchema` (JSON Schema of custom config, excluding standard fields)
  - `defaults` (e.g., `basePath`)
  - `exposedConfigProperties`
  - `adapterInterface` (e.g., `IDataAdapter`)
  - `proxyAdapterSource` (for API-wrapping services)
  - `prePipeline`, `postPipeline` (array spec; can use private services)
  - `privateServices` (map of private service specs with config transform)
  - `isFilter` (true → pass-through when no handler matches; good for pipeline filters)

Example (Data Service manifest):
```js path=null start=null
export default {
  name: "Data Service",
  description: "Reads and writes data from urls with the pattern datasource/key",
  moduleUrl: "./services/data.ts",
  apis: ["store", "data.base"],
  adapterInterface: "IDataAdapter",
  configSchema: {
    type: "object",
    properties: {
      uploadBaseUrl: { type: "string", description: "File store URL for uploads" }
    }
  },
  defaults: { basePath: "/data" },
  exposedConfigProperties: ["uploadBaseUrl"]
}
```

Example (Template Service manifest, showing pipelines/private services):
```js path=null start=null
export default {
  name: "Template",
  description: "Fill a template with data from the request",
  moduleUrl: "./services/template.ts",
  apis: ["store-transform"],
  adapterInterface: "ITemplateAdapter",
  isFilter: true,
  configSchema: {
    type: "object",
    properties: {
      outputMime: { type: "string" },
      metadataProperty: { type: "string" },
      store: {
        type: "object",
        properties: {
          adapterSource: { type: "string" },
          infraName: { type: "string" },
          adapterConfig: { type: "object", properties: {} },
          extension: { type: "string" },
          parentIfMissing: { type: "boolean" }
        },
        required: ["extension"]
      }
    },
    required: ["outputMime", "store"]
  },
  defaults: { metadataProperty: "$message" },
  postPipeline: ["if (method !== 'POST') $METHOD *store/$*", "/lib/delocalise-store-location"],
  privateServices: {
    store: {
      name: "'Template Store'",
      source: "./services/file.rsm.json",
      access: { readRoles: "access.readRoles", writeRoles: "access.writeRoles" },
      adapterInterface: "IFileAdapter",
      adapterSource: "store.adapterSource",
      infraName: "store.infraName",
      adapterConfig: "store.adapterConfig",
      extensions: "[ store.extension ]",
      parentIfMissing: "store.parentIfMissing === false ? false : true",
      storePattern: "'store-transform'",
      manualMimeTypes: {
        requestMimeType: "'application/json'",
        responseMimeType: "'text/plain'"
      }
    }
  }
}
```

## Typical workflow to build a new service

1) Create `services/<your-service>.ts`:
   - `import { Service } from "rs-core/Service.ts";`
   - Instantiate and register method handlers (use `get*/post*/put*/delete*/patch*/all*` as appropriate)
   - Use `context` for adapters (`context.adapter`), logging, internal requests (`context.makeRequest`), pipelines (`context.runPipeline`)
   - Manipulate `Message`/`MessageBody` for I/O
   - Export default service

2) Create `services/<your-service>.rsm.js` manifest:
   - Set `name`, `description`, `moduleUrl`, `apis`
   - Add `adapterInterface`, `configSchema`, `defaults.basePath`, and other optional fields as needed
   - For wrapper/proxy-type services, set `proxyAdapterSource`
   - For pipeline/filter behavior, use `prePipeline`/`postPipeline`, `privateServices`, and/or `isFilter`

3) If the service maintains internal state, define a `BaseStateClass` and initialize via `initializer` or lazy `context.state(...)`.

## Notes and gotchas

- Base path and subpaths: handler lookups consider the configured base path plus any handler subpath. Adjust `msg.url.basePathElements` only if you intentionally rebase (e.g., proxy).
- HEAD and OPTIONS: HEAD is auto-served using GET/ALL where possible. OPTIONS can be handled explicitly (e.g., CORS preflight in Proxy service).
- PUT defaulting: a PUT without a specific PUT handler can fall back to POST behavior (body cleared afterwards) unless `isFilter` is true.
- Validation: when you pass `schema`/`mimeTypes` to `post/put`, the Service wraps your handler with validation and content-type enforcement.
- Errors and caching: setting an error status automatically applies `no-cache` headers.

This guide was synthesized from `services/README.md`, representative services and manifests in `services/`, and core APIs in `rs-core` (Service.ts, Message.ts, MessageBody.ts).
