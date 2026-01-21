import { ApiPattern } from "rs-core/DirDescriptor.ts";
import { IAccessControl, IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IServiceManifest } from "rs-core/IManifest.ts";
import { config } from "./config.ts";
import { Tenant } from "./tenant.ts";

type PatternInfo = {
    description: string;
    methods: string[];
    pathFormat?: string;
    keyDescription?: string;
    getDescription?: string;
    postDescription?: string;
};

type EndpointInfo = {
    method: string;
    path: string;
    description: string;
    example?: Record<string, unknown>;
};

const patternDocs: Record<string, PatternInfo> = {
    store: {
        description: "RESTful CRUD directory",
        methods: [ "GET", "POST", "PUT", "DELETE" ],
        pathFormat: "{basePath}/{key}",
        keyDescription: "Resource identifier, can be multi-segment path"
    },
    "store-transform": {
        description: "Store + transform combined",
        methods: [ "GET", "POST", "PUT", "DELETE" ],
        pathFormat: "{basePath}/{key}",
        getDescription: "Read stored item",
        postDescription: "Transform data using stored item as template"
    },
    "store-view": {
        description: "Stored resources with view semantics",
        methods: [ "GET", "POST", "PUT", "DELETE" ],
        pathFormat: "{basePath}/{key}"
    },
    "store-operation": {
        description: "Stored resources that trigger operations",
        methods: [ "GET", "POST", "PUT", "DELETE" ],
        pathFormat: "{basePath}/{key}"
    },
    "store-directory": {
        description: "Store with fixed directory structure",
        methods: [ "GET", "POST", "PUT", "DELETE" ],
        pathFormat: "{basePath}/{key}"
    },
    transform: {
        description: "POST-only transformation endpoint",
        methods: [ "POST" ],
        pathFormat: "{basePath}"
    },
    view: {
        description: "Read-only GET endpoint",
        methods: [ "GET" ],
        pathFormat: "{basePath}"
    },
    operation: {
        description: "Action endpoint (no response body)",
        methods: [ "POST", "PUT" ],
        pathFormat: "{basePath}"
    },
    directory: {
        description: "Fixed URL structure",
        methods: [ "varies by endpoint" ],
        pathFormat: "{basePath}"
    }
};

const endpointDescriptions: Record<string, string> = {
    GET: "Read resource",
    POST: "Create or transform data",
    PUT: "Create or update resource",
    DELETE: "Delete resource"
};

const patternFromManifest = (manifest: IServiceManifest): ApiPattern => {
    const apis = manifest.apis || [];
    if (apis.includes("store-transform")) return "store-transform";
    if (apis.includes("store-view")) return "store-view";
    if (apis.includes("store-operation")) return "store-operation";
    if (apis.includes("store-directory")) return "store-directory";
    if (apis.includes("transform")) return "transform";
    if (apis.includes("view")) return "view";
    if (apis.includes("operation")) return "operation";
    if (apis.includes("directory")) return "directory";
    return "store";
};

const buildEndpoints = (basePath: string, pattern: string): EndpointInfo[] => {
    const endpoints: EndpointInfo[] = [];
    if (pattern.startsWith("store")) {
        const path = `${basePath}/{key}`;
        for (const method of [ "GET", "POST", "PUT", "DELETE" ]) {
            endpoints.push({
                method,
                path,
                description: endpointDescriptions[method],
                example: { path: `${basePath}/example` }
            });
        }
        return endpoints;
    }
    if (pattern === "transform") {
        endpoints.push({
            method: "POST",
            path: basePath,
            description: "Transform posted data",
            example: { path: basePath, body: { input: "value" } }
        });
        return endpoints;
    }
    if (pattern === "view") {
        endpoints.push({
            method: "GET",
            path: basePath,
            description: "Read view output",
            example: { path: basePath }
        });
        return endpoints;
    }
    if (pattern === "operation") {
        endpoints.push({
            method: "POST",
            path: basePath,
            description: "Execute operation",
            example: { path: basePath, body: { input: "value" } }
        });
        endpoints.push({
            method: "PUT",
            path: basePath,
            description: "Execute operation",
            example: { path: basePath, body: { input: "value" } }
        });
        return endpoints;
    }
    endpoints.push({
        method: "GET",
        path: basePath,
        description: "List directory entries",
        example: { path: basePath }
    });
    return endpoints;
};

const extractAccess = (service: IServiceConfig): IAccessControl | undefined => {
    return service.access;
};

export const buildAgentDiscovery = async (tenant: Tenant) => {
    const services: Record<string, unknown>[] = [];

    for (const [ basePath, service ] of Object.entries(tenant.servicesConfig!.services)) {
        const manifest = await config.modules.getServiceManifest(service.source, tenant.name);
        if (typeof manifest === "string") {
            config.logger.error(`Failed to get manifest for ${service.source}: ${manifest}`);
            continue;
        }
        const pattern = patternFromManifest(manifest);
        const patternDescription = patternDocs[pattern]?.description;
        services.push({
            basePath,
            name: service.name,
            source: service.source,
            description: manifest.description,
            pattern,
            patternDescription,
            access: extractAccess(service),
            endpoints: buildEndpoints(basePath, pattern)
        });
    }

    return {
        server: {
            version: Deno.env.get("RS_VERSION") ?? "unknown",
            tenant: tenant.name
        },
        patterns: patternDocs,
        services,
        concepts: {
            authentication: {
                description: "JWT-based auth via rs-auth cookie or Authorization header",
                loginEndpoint: "/auth/login",
                loginMethod: "POST",
                loginBody: { email: "string", password: "string" }
            },
            pipelines: {
                description: "Chain multiple API calls with transforms",
                storePattern: "Pipeline specs stored as JSON files",
                executePattern: "POST to pipeline endpoint with input data"
            },
            queries: {
                description: "Parameterized query templates",
                storePattern: "Query templates stored as text files",
                executePattern: "POST to query endpoint with parameters"
            }
        }
    };
};
