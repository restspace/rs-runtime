# Restspace Runtime

This Deno program acts as a multi-tenant web server which can be configured using a JSON file to run packages of code called service components which handle requests to a subtree of url paths.

## Other repositories

The repo has many dependencies on Restspace Core. Restspace Core contains all the necessary dependencies for custom service or adapter code: when writing your own service or adapter, you won't need any dependencies in Restspace Runtime.

## Site and documentation

The main site for Restspace is at (http://restspace.io)[http://restspace.io].
The technical overview in the documentation for Restspace is at (https://restspace.io/docs/overview/Technical%20Overview)[https://restspace.io/docs/overview/Technical%20Overview].

## Code Architecture

### Entrypoint

`server.ts` sets up and runs the http server. Code for handling requests is in `handleRequest.ts`.

### Tenants

The server code lazy-loads configuration for a tenant (`tenant.ts`) when it first encounters a url which maps to that tenant. This mapping is based on subdomain or mappings in `serverConfig.json`. This file also specifies an *infra* (see below) which is a configuration element that tells it how and from where to load the tenant configuration.

`tenant.ts` contains code to process a tenant configuration JSON (`services.json`), into an in-memory representation of the tenant. This process preloads the manifests of the services that are configured.

### Manifests and Services

A manifest is a JSON specification of metadata about a service component. The built-in services have their manifests in `services/` and these files normally have the standard suffix `.rsm.json`. In the built-in case, these are actually `.js` files to simplify loading. The manifest specifies such things as the name and description of the service, the location of the code file for the code of the service, the schema of its custom configuration etc.

`Modules.ts` contains a class that holds in memory the manifests of the services specified in tenants' configurations. On demand, it loads the code for the service from the filesystem or internet from the location specified in the manifest and holds it in memory. Deno makes this very straightforward compared to Node and this is the key reason for the choice of Deno as the underlying JS runtime.

Manifests can also be compositions of services as they can specify a pipeline to run either/both before and after the main service they refer to.

### Adapters

A service component provides an HTTP interface to functionality. It can optionally be configured to load an *adapter* which is a class with a standard interface that provides pluggable access to functionality provided by a range of infrastructure services. Again this is lazily loaded at runtime from local files or the internet, and it has its own manifest suffixed `.ram.json`. Adapters have their own configuration: this may include things like access keys or tokens to access the infrastructure service.

### Infra

An *infra* is an adapter whose declared in the `serverConfig.json` file or [to add] in the `services.json` file with partial configuration. A service can be configured to use an infra rather than an adapter. This has the dual advantage that it requires less configuration, and that its preset configuration can be kept hidden from users with a lower level of authorisation who can still make use of the infrastructure it connects to.

### Url handling procedure

A request is received at the server in `server.ts`. This is passed to `handleRequest.js` `handleIncomingRequest()`. This loads the relevant tenant if missing, then calls `tenant.ts` `getMessageFunctionByUrl()` which forwards to the same-named function in `ServiceFactory.ts`. This class exists for each tenant, holding the service configuration structures for that tenant. It analyses the base urls of the configured services on the tenant, and picks the most specific match if any.

Then `ServiceFactory.ts` creates an adapter for the service, attaches it to a `ServiceContext` (defined in `rs-core`). It finds the configuration data for the service. It creates a wrapped service using `ServiceWrapper.ts` which handles commmon pre and post processing for all services. Then it calls one of two functions on this class, `internal` or `external`. The former wraps the custom code for the service with standard processing needed when the call to the service is made from within the runtime e.g. as part of a pipeline. The latter wraps this in turn with common code for receiving and sending messages to the web.

 `external` checks authentication and also manages CORS and caching headers. `internal` handles pre and post pipelines around the service. It calls the actual code of the service, passing in the HTTP request message, a context object with the adapter if any, plus some system functions including one which calls a local url on an internally, and the configuration data for the service.

 ### Testing

 The `/test` directory contains some tools which allow mocking an entire multitenant server configuration. `handleIncomingRequest` can then be called directly to run tests across nearly the whole system. Most of the test files provide examples of how to do this.

 This directory also contains tests for adapter interfaces which should ensure any new adapter follows implicit behavioural assumptions about how it should present its functionality e.g. a store adapter should persist data written returning it when subsequently read from the same location.

 ### Key Services

 In the `/services` directory are some core built-in services.

 - `auth.ts` supplies authentication to other services, it has a special function `setUser` which checks a user for an auth header or cookie and attaches the encoded user information to the request if present and correct. It has a built in role system with the core roles 'A' - administrator, 'E' - content editor and 'U' - site user.
 - `user-data.rsm.js` is a manifest that provides a data store service for user information with security features forbidding certain kinds of edits of sensitive information e.g. passwords. This works in conjunction with `auth.ts`
 - `services.ts` is an API to manage the tenant's configuration, normally only accessible to an authenticated administrator. The configuration can be changed at runtime with no special precautions, this being greatly simplified by JS being single-threaded. This is still a rather tricky undertaking and it is quite possible this may cause issues with edge cases where a request is blocked on an async call and has configuration changed under it. This also supplies the list of available services and will provide search functions on this catalogue. Additionally it supports 'chords' which are configuration fragments the list of which are composed into a consistent deduplicated single configuration every time it is changed.
 - `pipeline.ts` provides a full-featured facility for a request to be passed through a series of services, the response data from one being passed into the next as a request. Requests can be run in parallel and JSON data transformed between calls. This is the main composition primitive for Restspace.



