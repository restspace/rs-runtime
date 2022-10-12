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

Handlers (whose type is `ServiceFunction`) are functions with this signature:

    (msg: Message, context: SimpleServiceContext, config: IServiceConfig) => Promise<Message>

[Message](https://github.com/restspace/rs-core/blob/master/Message.ts) is a class which corresponds to both an HTTP request and an HTTP response.

[SimpleServiceContext](https://github.com/restspace/rs-core/blob/master/ServiceContext.ts) is a JSON object which supplies contextual information to the request as below:

|Property|Type|Use|
|---|---|---|
|tenant|string|The tenant name of the current restspace tenant. For hosted Restspace instances, this will be the subdomain of https://restspace.io on which the site is hosted.|
|prePost?|"pre" \| "post"|"pre" if we are in the prePipeline of a service, "post" if in the postPipeline|
|makeRequest|(msg: Message, externality?: Source) => Promise<Message>|Sends the message as a request using its url. Internal requests always have a site-relative url starting '/'. Internal requests are handled in code and do not use the network, so essentially have no latency. The default source, `Source.Internal` means no further authentication is done on internal requests. If `Source.Outer` is specified, an internal request will be authenticated against the user attached to the request.|
|runPipeline|(msg: Message, pipelineSpec: PipelineSpec, contextUrl? Url) => Promise<Message>|Runs a pipeline of requests as given. The contextUrl if supplied gives the url against which url patterns in the pipeline are matched.|
|logger|Logger|Gives access to a logger as in std/log|
|manifest|IServiceManifest|The manifest of the current service|
|getAdapter|<T extends IAdapter>(url: string, config: unknown) => Promise<T>|Loads the adapter whose manifest is at the supplied `url` and uses the given `config` to construct the adapter class and return it|
|makeProxyRequest|(msg: Message) => Promise<Message>|Makes a request given the request message using the Proxy Adapter specified in this service's manifest to preprocess it|
|state|<T extends BaseStateClass>(cons: StateClass<T>, context: SimpleServiceContext, config: unknown) => Promise<T>|see managing state below|

In the example, a handler is configured for a get request to the service. Methods on Service class for configuring handlers are as follows:

|Method|Type|Use|
|---|---|---|
|get|(ServiceFunction) => this|Configure a handler for all get requests|
|getPath|(string, ServiceFunction) => this|Configure a handler for get requests with a specific service path|
|getDirectory|(ServiceFunction) => this|Configure a handler for get requests to any directory (path ends '/')|
|getDirectoryPath|(string, ServiceFunction) => this|Configure a handler for get requests to a directory with a specific service path|
|post|(ServiceFunction) => this|Configure a handler for all post requests|
|postPath|(string, ServiceFunction) => this|Configure a handler for post requests with a specific service path|
|postDirectory|(ServiceFunction) => this|Configure a handler for post requests to any directory (path ends '/')|
|postDirectoryPath|(string, ServiceFunction) => this|Configure a handler for post requests to a directory with a specific service path|
|put|(ServiceFunction) => this|Configure a handler for all put requests|
|putPath|(string, ServiceFunction) => this|Configure a handler for put requests with a specific service path|
|putDirectory|(ServiceFunction) => this|Configure a handler for put requests to any directory (path ends '/')|
|putDirectoryPath|(string, ServiceFunction) => this|Configure a handler for put requests to a directory with a specific service path|
|delete|(ServiceFunction) => this|Configure a handler for all delete requests|
|deletePath|(string, ServiceFunction) => this|Configure a handler for delete requests with a specific service path|
|deleteDirectory|(ServiceFunction) => this|Configure a handler for delete requests to any directory (path ends '/')|
|deleteDirectoryPath|(string, ServiceFunction) => this|Configure a handler for delete requests to a directory with a specific service path|
|patch|(ServiceFunction) => this|Configure a handler for all patch requests|
|patchPath|(string, ServiceFunction) => this|Configure a handler for patch requests with a specific service path|
|all|(ServiceFunction) => this|Configure a handler for all requests|
|allPath|(string, ServiceFunction) => this|Configure a handler for all requests with a specific service path|
|initializer|(ServiceContext<TAdapter>, ServiceConfig) => Promise<void>|Configure a handler to run when the service is first configured|

### Url segmentation
Conventionally in Restspace a handler will handle all requests whose paths begin with a specific base path. Path segments after the base path can be viewed as parameters to a function. The runtime facilitates this by passing in information about what base path was matched. The `Url` class manages this information through the following properties:

- basePathElements: string array of the segments which form the base path. This is the base path configured for the service concatenated with any path supplied to one of the handler configuring methods listed above.
- servicePath: the part of the path after the base path (as a string with / delimiters, and no query string attached)
- servicePathElements: string array of the segments of the service path
- subPathElements: this is relevant where the service manages a store with files specifying functional definitions, otherwise it is null. Where it is present, the service path is the path under the base path to the file, and the sub path is the path following that which can be considered as parameters to the function expressed by the file. It contains the sub path as an array of segments.


## Managing State

Services are essentially stateless and functional, although they may link to stateful services via adapters. Restspace provides an explicit mechanism for services to have state.

To add state to a service, first define a class which implements BaseStateClass to provide two methods, load() and unload() both async methods returning a Promise<void>. load() is called by the runtime when the state is first accessed by each configured instance of a service. The runtime passes in the context and config for that service instance. unload() is called by the runtime when the services for a tenant are changed, before load() is called again with the new configuration.

Then choose how to load the service. To eager load it when the service is first configured, do this:

    service.initializer(async (context, config) => {
	    await context.state(DiscordState, context, config);
    });

`context.state` is a function on a ServiceContext which given the constructor for the state class and the current context and config, returns an instance of the state class, creating one if one does not already exist.

So to lazy load the state, simply call context.state where appropriate and the first invocation will create the state class instance.