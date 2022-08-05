# Restspace Service Components

This directory contains built in service components. Service components are simple to build, with a programming API similar to ExpressJS controllers. Here is how to do this.

## Services and Adapters
The service component architecture distinguishes between a service, which can be deployed to a server by Restspace on a base URL, and an adapter, which is used by various services to provide switchable access to external resources. To impose simplicity, each service can have only one adapter configured for it (exceptionally, you can also configure a Proxy Adapter for services which wrap APIs)

## Manifests
Every service or adapter has a JSON manifest file. This specifies information about the service in a standard format described below:

|Property|Meaning|
|---|---|
|name*|The name of the service|
|description*|A paragraph or two on what the service does, for listing and discovery|
|moduleUrl*|The url where the JS or TS source for the module can be found|
|apis*|A list of strings naming the APIs this service fulfills. It is fine to make up a new name here, the purpose is to identify where services share APIs so they can be treated similarly|
|configSchema|A JSON Schema specifying the custom (only) configuration properties for this service. Omit the standard configuration properties as these are assumed. Omit this property if only the standard configuration properties are used.|
|defaults|A JSON object specifying properties and their default values|
|exposedConfigProperties|A list of strings giving the property names of configuration properties which are publically visible|
|adapterInterface|If present, specifies the Typescript interface name (which will usually be present in the Restspace Core repo) which the adapter must implement.|
|proxyAdapterSource|For services which wrap underlying APIs, specifies the source of an adapter which implements IProxyAdapter to be used to preprocess requests to the API|
|prePipeline|A pipeline specification which can include private services to be run on any incoming request, its output then being passed to the service|
|postPipeline|A pipeline specification which can include private services to be run on the response from the service, the output of the pipeline being passed back to the client who called the service|
|privateServices|A JSON object which keys are service names and whose values are objects specifying a transform from the service's configuration JSON object to the configuration for the private service.|
|isFilter|If present and true, the service behaviour is changed. Normally, if a service does not have a handler specified for a given request method or subpath, the request is returned as a 404. If isFilter is set, the request is returned unchanged. This allows private services in a pipeline to only process certain messages while passing the others on to the next step unchanged.|

\* = required

Conventionally, the name of a service manifest is *.rsm.json and of an adapter manifest, *.ram.json.

## Service code
Restspace is intended to be used with Typescript, so this will assume use of Typescript. A service is generally a single .ts (or .js) file. Here's the most basic example:

    import { Service } from "rs-core/Service.ts";

    const service = new Service();

    service.get((msg) => Promise.resolve(msg.setText('hello world')));

    export default service;


Essentially, we create a `Service` object, attach handlers to it, then return it as the default export. This example returns a text response with 'hello world' for a GET request to any sub path of the base path on which it is configured.

Handlers are functions with this signature:

    (msg: Message, context: SimpleServiceContext, config: IServiceConfig) => Promise<Message>

[Message](https://github.com/restspace/rs-core/blob/master/Message.ts) is a class which corresponds to both an HTTP request and an HTTP response.

[SimpleServiceContext](https://github.com/restspace/rs-core/blob/master/ServiceContext.ts) is a JSON object which supplies contextual information to the request as below:

|Property|Type|Use|
|---|---|---|
|tenant|string|The tenant name of the current restspace tenant. For hosted Restspace instances, this will be the subdomain of https://restspace.io on which the site is hosted.|
|prePost?|"pre" \| "post"|"pre" if we are in the prePipeline of a service, "post" if in the postPipeline|
|makeRequest|(msg: Message, externality?: Externality) => Promise<Message>|Sends the message as a request using its url. Internal requests always have a site-relative url starting '/'. Internal requests are handled in code and do not use the network, so essentially have no latency. The default externality, `Externality.Internal` means no further authentication is done on internal requests. If `Externality.External` is specified, an internal request will be authenticated against the user attached to the request.|
|runPipeline|(msg: Message, pipelineSpec: PipelineSpec, contextUrl? Url) => Promise<Message>|Runs a pipeline of requests as given. The contextUrl if supplied gives the url against which url patterns in the pipeline are matched.|
|logger|Logger|Gives access to a logger as in std/log|
|manifest|IServiceManifest|The manifest of the current service|
|getAdapter|<T extends IAdapter>(url: string, config: unknown) => Promise<T>|Loads the adapter whose manifest is at the supplied `url` and uses the given `config` to construct the adapter class and return it|
|makeProxyRequest|(msg: Message) => Promise<Message>|Makes a request given the request message using the Proxy Adapter specified in this service's manifest to preprocess it|
|state|<T extends BaseStateClass>(cons: StateClass<T>, context: SimpleServiceContext, config: unknown) => Promise<T>|see managing state below|
