import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import Ajv, { ValidateFunction } from "https://cdn.skypack.dev/ajv?dts";
import { getErrors } from "rs-core/utility/errors.ts";
import { assignProperties } from "rs-core/utility/schema.ts";
import { IServiceConfig, IServiceConfigTemplate, schemaIServiceConfig } from "rs-core/IServiceConfig.ts";
import { Url } from "rs-core/Url.ts";
import { IAdapterManifest, IManifest, IServiceManifest } from "rs-core/IManifest.ts";
import { config, Infra } from "./config.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";

import LocalFileAdapter from "./adapter/LocalFileAdapter.ts";
import LocalFileAdapterManifest from "./adapter/LocalFileAdapter.ram.js";
import S3FileAdapter from "./adapter/S3FileAdapter.ts";
import S3FileAdapterManifest from "./adapter/S3FileAdapter.ram.js";
import NunjucksTemplateAdapter from "./adapter/NunjucksTemplateAdapter.ts";
import NunjucksTemplateAdapterManifest from "./adapter/NunjucksTemplateAdapter.ram.js";
import SimpleProxyAdapter from "./adapter/SimpleProxyAdapter.ts";
import SimpleProxyAdapterManifest from "./adapter/SimpleProxyAdapter.ram.js";
import AWS4ProxyAdapter from "./adapter/AWS4ProxyAdapter.ts";
import AWS4ProxyAdapterManifest from "./adapter/AWS4ProxyAdapter.ram.js";
import ElasticProxyAdapter from "./adapter/ElasticProxyAdapter.ts";
import ElasticProxyAdapterManifest from "./adapter/ElasticProxyAdapter.ram.js";
import ElasticDataAdapter from "./adapter/ElasticDataAdapter.ts";
import ElasticDataAdapterManifest from "./adapter/ElasticDataAdapter.ram.js";
import ElasticQueryAdapter from "./adapter/ElasticQueryAdapter.ts";
import ElasticQueryAdapterManifest from "./adapter/ElasticQueryAdapter.ram.js";

import Services from "./services/services.ts";
import ServicesManifest from "./services/services.rsm.js";
import Auth from "./services/auth.ts";
import AuthManifest from "./services/auth.rsm.js";
import Data from "./services/data.ts";
import DataManifest from "./services/data.rsm.js";
import Dataset from "./services/dataset.ts";
import DatasetManifest from "./services/dataset.rsm.js";
import File from "./services/file.ts";
import FileManifest from "./services/file.rsm.js";
import Lib from "./services/lib.ts";
import LibManifest from "./services/lib.rsm.js";
import Pipeline from "./services/pipeline.ts";
import PipelineManifest from "./services/pipeline.rsm.js";
import PipelineStore from "./services/pipeline-store.ts";
import PipelineStoreManifest from "./services/pipeline-store.rsm.js";
import StaticSiteFilter from "./services/static-site-filter.ts";
import StaticSiteFilterManifest from "./services/static-site-filter.rsm.js";
import StaticSiteManifest from "./services/static-site.rsm.js";
import UserDataManifest from "./services/user-data.rsm.js";
import UserFilterManifest from "./services/user-filter.rsm.js";
import UserFilter from "./services/user-filter.ts";
import Template from "./services/template.ts";
import TemplateManifest from "./services/template.rsm.js";
import Proxy from "./services/proxy.ts";
import ProxyManifest from "./services/proxy.rsm.js";
import Email from "./services/email.ts";
import EmailManifest from "./services/email.rsm.js";
import Account from "./services/account.ts";
import AccountManifest from "./services/account.rsm.js";
import Discord from "./services/discord.ts";
import DiscordManifest from "./services/discord.rsm.js";
import TemporaryAccess from "./services/temporary-access.ts";
import TemporaryAccessManifest from "./services/temporary-access.rsm.js";
import Query from "./services/query.ts";
import QueryManifest from "./services/query.rsm.js";

import { AdapterContext, nullState } from "../rs-core/ServiceContext.ts";
import { makeServiceContext } from "./makeServiceContext.ts";
import { transformation } from "rs-core/transformation/transformation.ts";

export const schemaIServiceManifest = {
    type: "object",
    properties: {
        "name": { type: "string" },
        "description": { type: "string" },
        "moduleUrl": { type: "string" },
        "configSchema": {
            type: "object",
            properties: { }
        },
        "apis": {
            type: "array",
            items: { type: "string" }
        },
        "adapterInterface": { type: "string" },
        "privateServices": { type: "object" },
        "prePipeline": { type: "array" },
        "postPipeline": { type: "array" }
    },
    required: [ "name", "description", "moduleUrl" ]
};

export const schemaIAdapterManifest = {
    type: "object",
    properties: {
        "name": { type: "string" },
        "description": { type: "string" },
        "moduleUrl": { type: "string" },
        "configSchema": {
            type: "object",
            properties: { }
        },
        "adapterInterfaces": {
            type: "array",
            items: { type: "string" }
        }
    },
    required: [ "name", "description", "moduleUrl", "adapterInterfaces" ]
};

export function manifestIsService(manifest: IManifest): manifest is IServiceManifest {
    return !("adapterInterfaces" in manifest);
}

export function applyServiceConfigTemplate(serviceConfig: IServiceConfig, configTemplate: IServiceConfigTemplate): IServiceConfig {
    const transformObject = { ...configTemplate };
    delete (transformObject as any).source;
    const outputConfig = transformation(transformObject, serviceConfig, new Url(configTemplate.source));
    outputConfig.source = configTemplate.source;
    return outputConfig;
}

/** Modules is a singleton which holds compiled services and adapters for all tenants */
export class Modules {
    adapterConstructors: { [ name: string ]: new (context: AdapterContext, config: unknown) => IAdapter } = {};
    serviceManifests: { [ name: string ]: IServiceManifest } = {};
    adapterManifests: { [ name: string ]: IAdapterManifest } = {};
    services: { [ name: string ]: Service } = {};
    validateServiceManifest: ValidateFunction<IServiceManifest>;
    validateAdapterManifest: ValidateFunction<IAdapterManifest>;
    validateAdapterConfig: { [ source: string ]: ValidateFunction } = {};
    validateServiceConfig: { [ source: string ]: ValidateFunction } = {};

    constructor(public ajv: Ajv) {
        this.validateServiceManifest = ajv.compile<IServiceManifest>(schemaIServiceManifest);
        this.validateAdapterManifest = ajv.compile<IAdapterManifest>(schemaIAdapterManifest);

        // Statically load core services & adapters
        
        this.adapterConstructors = {
            "./adapter/LocalFileAdapter.ts": LocalFileAdapter,
            "./adapter/S3FileAdapter.ts": S3FileAdapter,
            "./adapter/NunjucksTemplateAdapter.ts": NunjucksTemplateAdapter,
            "./adapter/SimpleProxyAdapter.ts": SimpleProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/AWS4ProxyAdapter.ts": AWS4ProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/ElasticProxyAdapter.ts": ElasticProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/ElasticDataAdapter.ts": ElasticDataAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/ElasticQueryAdapter.ts": ElasticQueryAdapter as new (context: AdapterContext, props: unknown) => IAdapter
        };
        this.adapterManifests = {
            "./adapter/LocalFileAdapter.ram.json": LocalFileAdapterManifest,
            "./adapter/S3FileAdapter.ram.json": S3FileAdapterManifest,
            "./adapter/NunjucksTemplateAdapter.ram.json": NunjucksTemplateAdapterManifest,
            "./adapter/SimpleProxyAdapter.ram.json": SimpleProxyAdapterManifest,
            "./adapter/AWS4ProxyAdapter.ram.json": AWS4ProxyAdapterManifest,
            "./adapter/ElasticProxyAdapter.ram.json": ElasticProxyAdapterManifest,
            "./adapter/ElasticDataAdapter.ram.json": ElasticDataAdapterManifest,
            "./adapter/ElasticQueryAdapter.ram.json": ElasticQueryAdapterManifest
        };
        Object.entries(this.adapterManifests).forEach(([url, v]) => {
            (v as any).source = url;
            this.validateAdapterConfig[url] = this.ajv.compile(this.adapterManifests[url].configSchema || {});
        });

        this.services = {
            "./services/services.ts": Services,
            "./services/auth.ts": Auth as unknown as Service<IAdapter, IServiceConfig>,
            "./services/data.ts": Data as unknown as Service<IAdapter, IServiceConfig>,
            "./services/dataset.ts": Dataset as unknown as Service<IAdapter, IServiceConfig>,
            "./services/file.ts": File as unknown as Service<IAdapter, IServiceConfig>,
            "./services/lib.ts": Lib,
            "./services/pipeline.ts": Pipeline as unknown as Service<IAdapter, IServiceConfig>,
            "./services/pipeline-store.ts": PipelineStore as unknown as Service<IAdapter, IServiceConfig>,
            "./services/static-site-filter.ts": StaticSiteFilter as unknown as Service<IAdapter, IServiceConfig>,
            "./services/user-filter.ts": UserFilter,
            "./services/template.ts": Template as unknown as Service<IAdapter, IServiceConfig>,
            "./services/proxy.ts": Proxy as unknown as Service<IAdapter, IServiceConfig>,
            "./services/email.ts": Email as unknown as Service<IAdapter, IServiceConfig>,
            "./services/account.ts": Account as unknown as Service<IAdapter, IServiceConfig>,
            "./services/discord.ts": Discord as unknown as Service<IAdapter, IServiceConfig>,
            "./services/temporary-access.ts": TemporaryAccess as unknown as Service<IAdapter, IServiceConfig>,
            "./services/query.ts": Query as unknown as Service<IAdapter, IServiceConfig>
        };
        this.serviceManifests = {
            "./services/services.rsm.json": ServicesManifest,
            "./services/auth.rsm.json": AuthManifest,
            "./services/data.rsm.json": DataManifest,
            "./services/dataset.rsm.json": DatasetManifest,
            "./services/file.rsm.json": FileManifest,
            "./services/lib.rsm.json": LibManifest,
            "./services/pipeline.rsm.json": PipelineManifest,
            "./services/pipeline-store.rsm.json": PipelineStoreManifest as unknown as IServiceManifest,
            "./services/static-site-filter.rsm.json": StaticSiteFilterManifest,
            "./services/static-site.rsm.json": StaticSiteManifest as unknown as IServiceManifest,
            "./services/user-data.rsm.json": UserDataManifest as unknown as IServiceManifest,
            "./services/user-filter.rsm.json": UserFilterManifest,
            "./services/template.rsm.json": TemplateManifest as unknown as IServiceManifest,
            "./services/proxy.rsm.json": ProxyManifest,
            "./services/email.rsm.json": EmailManifest,
            "./services/account.rsm.json": AccountManifest,
            "./services/discord.rsm.json": DiscordManifest,
            "./services/temporary-access.rsm.json": TemporaryAccessManifest,
            "./services/query.rsm.json": QueryManifest as unknown as IServiceManifest
        };
        Object.entries(this.serviceManifests).forEach(([url, v]) => {
            (v as any).source = url;
            this.ensureServiceConfigValidator(url);
        });
    }

    async getConfigAdapter(tenant: string) {
        const configStoreAdapterSpec = { ...config.server.infra[config.server.configStore] };
        (configStoreAdapterSpec as Infra & { basePath: '/' }).basePath = "/";
        const context = makeServiceContext(tenant, nullState);
        const configAdapter = await config.modules.getAdapter<IFileAdapter>(configStoreAdapterSpec.adapterSource, context, configStoreAdapterSpec);
        return configAdapter;
    }

    async getAdapterConstructor<T extends IAdapter>(url: string): Promise<new (context: AdapterContext, config: unknown) => T> {
        if (!this.adapterConstructors[url]) {
            try {
            const module = await import(url);
            this.adapterConstructors[url] = module.default;
            } catch (err) {
                throw new Error(`failed to load adapter at ${url}: ${err}`);
            }
        }
        return this.adapterConstructors[url] as new (context: AdapterContext, config: unknown) => T;
    }

    async getAdapterManifest(url: string): Promise<IAdapterManifest | string> {
        if (!this.adapterManifests[url]) {
            try {
                const manifestJson = await Deno.readTextFile(url);
                const manifest = JSON.parse(manifestJson);
                manifest.source = url;
                this.adapterManifests[url] = manifest;
            } catch (err) {
                return `failed to load manifest at ${url}: ${err}`;
            }

            if (!this.validateAdapterManifest(this.adapterManifests[url])) {
                return `bad format manifest at ${url}: ${getErrors(this.validateAdapterManifest)}`;
            }

            if (!this.validateAdapterConfig[url]) {
                this.validateAdapterConfig[url] = this.ajv.compile(this.adapterManifests[url].configSchema || {})
            }
        }
        return this.adapterManifests[url];
    }

    /** returns a new instance of an adapter */
    async getAdapter<T extends IAdapter>(url: string, context: AdapterContext, config: unknown): Promise<T> {
        if (url.split('?')[0].endsWith('.ram.json')) {
            const manifest = await this.getAdapterManifest(url);
            if (typeof manifest === 'string') throw new Error(manifest);
            url = manifest.moduleUrl as string;
        }

        const constr = await this.getAdapterConstructor(url);
        return new constr(context, config) as T;
    }

    ensureServiceConfigValidator(url: string) {
        if (!this.validateServiceConfig[url]) {
            let configSchema: Record<string, unknown> = schemaIServiceConfig;
            const serviceManifest = this.serviceManifests[url];
            if (serviceManifest.configSchema) {
                configSchema = assignProperties(serviceManifest.configSchema, schemaIServiceConfig.properties, schemaIServiceConfig.required);
            }

            this.validateServiceConfig[url] = this.ajv.compile(configSchema);
        }
    }

    async getServiceManifest(url: string): Promise<IServiceManifest | string> {
        if (!this.serviceManifests[url]) {
            try {
                const manifestJson = await Deno.readTextFile(url);
                const manifest = JSON.parse(manifestJson);
                manifest.source = url;
                this.serviceManifests[url] = manifest;
            } catch (err) {
                return `failed to load manifest at ${url}: ${err}`;
            }

            if (!this.validateServiceManifest(this.serviceManifests[url])) {
                return `bad format manifest at ${url}: ${(this.validateServiceManifest.errors || []).map(e => e.message).join('; ')}`;
            }

            this.ensureServiceConfigValidator(url);
        }
        return this.serviceManifests[url];
    }

    async getService(url?: string): Promise<Service> {
        if (url === undefined) {
            return Service.Identity; // returns message unchanged
        }

        // pull manifest if necessary
        if (url.split('?')[0].endsWith('.rsm.json')) {
            const manifest = await this.getServiceManifest(url);
            if (typeof manifest === 'string') throw new Error(manifest);
            url = manifest.moduleUrl;
            if (url === undefined) return Service.Identity;
        }

        if (!this.services[url]) {
            try {
                config.logger.debug(`Start -- loading service at ${url}`);
                const module = await import(url);
                this.services[url] = module.default;
                config.logger.debug(`End -- loading service at ${url}`);
            } catch (err) {
                throw new Error(`failed to load module at ${url}: ${err}`);
            }
        }
        return this.services[url];
    }
}
