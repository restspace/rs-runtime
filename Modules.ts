import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { Validate } from "https://cdn.skypack.dev/@exodus/schemasafe?dts"
import { getErrors } from "rs-core/utility/errors.ts";
import { assignProperties } from "rs-core/utility/schema.ts";
import { IServiceConfig, IServiceConfigTemplate, schemaIServiceConfig } from "rs-core/IServiceConfig.ts";
import { Url } from "rs-core/Url.ts";
import { IAdapterManifest, IManifest, IServiceManifest } from "rs-core/IManifest.ts";
import { Infra, config } from "./config.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";

import TestConfigFileAdapterManifest from "./test/TestConfigFileAdapter.ram.js";
import LocalFileAdapterManifest from "./adapter/LocalFileAdapter.ram.js";
import S3FileAdapterManifest from "./adapter/S3FileAdapter.ram.js";
import NunjucksTemplateAdapterManifest from "./adapter/NunjucksTemplateAdapter.ram.js";
import SimpleProxyAdapterManifest from "./adapter/SimpleProxyAdapter.ram.js";
import AWS4ProxyAdapterManifest from "./adapter/AWS4ProxyAdapter.ram.js";
import ElasticProxyAdapterManifest from "./adapter/ElasticProxyAdapter.ram.js";
import ElasticDataAdapterManifest from "./adapter/ElasticDataAdapter.ram.js";
import ElasticQueryAdapterManifest from "./adapter/ElasticQueryAdapter.ram.js";
import FileLogReaderAdapterManifest from "./adapter/FileLogReaderAdapter.ram.js";
import SnsSmsAdapterManifest from "./adapter/SnsSmsAdapter.ram.js";
import BotProxyAdapterManifest from "./adapter/BotProxyAdapter.ram.js";
import BinanceProxyAdapterManifest from "./adapter/BinanceProxyAdapter.ram.js";
import MongoDbDataAdapterManifest from "./adapter/MongoDbDataAdapter.ram.js";
import MongoDbQueryAdapterManifest from "./adapter/MongoDbQueryAdapter.ram.js";
import IMAPAdapterManifest from "./adapter/IMAPAdapter.ram.js";

import MockManifest from "./services/mock.rsm.js";
import ServicesManifest from "./services/services.rsm.js";
import AuthManifest from "./services/auth.rsm.js";
import DataManifest from "./services/data.rsm.js";
import DatasetManifest from "./services/dataset.rsm.js";
import FileManifest from "./services/file.rsm.js";
import LibManifest from "./services/lib.rsm.js";
import PipelineManifest from "./services/pipeline.rsm.js";
import PipelineStoreManifest from "./services/pipeline-store.rsm.js";
import StaticSiteFilterManifest from "./services/static-site-filter.rsm.js";
import StaticSiteManifest from "./services/static-site.rsm.js";
import UserDataManifest from "./services/user-data.rsm.js";
import UserFilterManifest from "./services/user-filter.rsm.js";
import TemplateManifest from "./services/template.rsm.js";
import ProxyManifest from "./services/proxy.rsm.js";
import EmailManifest from "./services/email.rsm.js";
import AccountManifest from "./services/account.rsm.js";
import TemporaryAccessManifest from "./services/temporary-access.rsm.js";
import QueryManifest from "./services/query.rsm.js";
import CSVConverterManifest from "./services/csvConverter.rsm.js";
import LogReaderManifest from "./services/logReader.rsm.js";
import ServiceStoreManifest from "./services/service-store.rsm.js"
import TimerManifest from "./services/timer.rsm.js";
import SmsManifest from "./services/sms.rsm.js";
import WebScraperManifest from "./services/webScraperService.rsm.js";
import ReferencesManifest from "./services/references.rsm.js";
import TimerStoreManifest from "./services/timer-store.rsm.js";
import serverSideEventsManifest from "./services/server-side-events.rsm.js";
import StoreFromQueryManifest from "./services/store-from-query.rsm.js";
import EmailStoreManifest from "./services/emailStore.rsm.js";
import PrivateCallerManifest from "./services/private-caller.rsm.js";
import WebhooksManifest from "./services/webhooks.rsm.js";
import TotpManifest from "./services/totp.rsm.js";
import LogCollectorManifest from "./services/logCollector.rsm.js";

import { AdapterContext, SimpleServiceContext, nullState } from "rs-core/ServiceContext.ts";
import { makeServiceContext } from "./makeServiceContext.ts";
import { transformation } from "rs-core/transformation/transformation.ts";
import { getSource } from "./getSource.ts";
import { Message } from "rs-core/Message.ts";
import { handleOutgoingRequest } from "./handleRequest.ts";
import { pathCombine, upToLast } from "rs-core/utility/utility.ts";

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
        "configTemplate": {
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
        "configTemplate": {
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
    return outputConfig;
}

export type AdapterConstructor = new (context: AdapterContext, config: Record<string, any>) => IAdapter;
type BuiltInModuleLoader = () => Promise<{ default: unknown }>;

const builtInAdapterLoaders: Record<string, BuiltInModuleLoader> = {
    "./test/TestConfigFileAdapter.ts": () => import("./test/TestConfigFileAdapter.ts"),
    "./adapter/LocalFileAdapter.ts": () => import("./adapter/LocalFileAdapter.ts"),
    "./adapter/S3FileAdapter.ts": () => import("./adapter/S3FileAdapter.ts"),
    "./adapter/NunjucksTemplateAdapter.ts": () => import("./adapter/NunjucksTemplateAdapter.ts"),
    "./adapter/SimpleProxyAdapter.ts": () => import("./adapter/SimpleProxyAdapter.ts"),
    "./adapter/AWS4ProxyAdapter.ts": () => import("./adapter/AWS4ProxyAdapter.ts"),
    "./adapter/ElasticProxyAdapter.ts": () => import("./adapter/ElasticProxyAdapter.ts"),
    "./adapter/ElasticDataAdapter.ts": () => import("./adapter/ElasticDataAdapter.ts"),
    "./adapter/ElasticQueryAdapter.ts": () => import("./adapter/ElasticQueryAdapter.ts"),
    "./adapter/FileLogReaderAdapter.ts": () => import("./adapter/FileLogReaderAdapter.ts"),
    "./adapter/SnsSmsAdapter.ts": () => import("./adapter/SnsSmsAdapter.ts"),
    "./adapter/BotProxyAdapter.ts": () => import("./adapter/BotProxyAdapter.ts"),
    "./adapter/BinanceProxyAdapter.ts": () => import("./adapter/BinanceProxyAdapter.ts"),
    "./adapter/MongoDbDataAdapter.ts": () => import("./adapter/MongoDbDataAdapter.ts"),
    "./adapter/MongoDbQueryAdapter.ts": () => import("./adapter/MongoDbQueryAdapter.ts"),
    "./adapter/IMAPAdapter.ts": () => import("./adapter/IMAPAdapter.ts"),
};

const builtInServiceLoaders: Record<string, BuiltInModuleLoader> = {
    "./services/mock.ts": () => import("./services/mock.ts"),
    "./services/services.ts": () => import("./services/services.ts"),
    "./services/auth.ts": () => import("./services/auth.ts"),
    "./services/data.ts": () => import("./services/data.ts"),
    "./services/dataset.ts": () => import("./services/dataset.ts"),
    "./services/file.ts": () => import("./services/file.ts"),
    "./services/lib.ts": () => import("./services/lib.ts"),
    "./services/pipeline.ts": () => import("./services/pipeline.ts"),
    "./services/pipeline-store.ts": () => import("./services/pipeline-store.ts"),
    "./services/static-site-filter.ts": () => import("./services/static-site-filter.ts"),
    "./services/user-filter.ts": () => import("./services/user-filter.ts"),
    "./services/template.ts": () => import("./services/template.ts"),
    "./services/proxy.ts": () => import("./services/proxy.ts"),
    "./services/email.ts": () => import("./services/email.ts"),
    "./services/account.ts": () => import("./services/account.ts"),
    "./services/temporary-access.ts": () => import("./services/temporary-access.ts"),
    "./services/query.ts": () => import("./services/query.ts"),
    "./services/csvConverter.ts": () => import("./services/csvConverter.ts"),
    "./services/logReader.ts": () => import("./services/logReader.ts"),
    "./services/timer.ts": () => import("./services/timer.ts"),
    "./services/sms.ts": () => import("./services/sms.ts"),
    "./services/webScraperService.ts": () => import("./services/webScraperService.ts"),
    "./services/references.ts": () => import("./services/references.ts"),
    "./services/timer-store.ts": () => import("./services/timer-store.ts"),
    "./services/server-side-events.ts": () => import("./services/server-side-events.ts"),
    "./services/store-from-query.ts": () => import("./services/store-from-query.ts"),
    "./services/emailStore.ts": () => import("./services/emailStore.ts"),
    "./services/webhooks.ts": () => import("./services/webhooks.ts"),
    "./services/private-caller.ts": () => import("./services/private-caller.ts"),
    "./services/totp.ts": () => import("./services/totp.ts"),
    "./services/logCollector.ts": () => import("./services/logCollector.ts"),
};

/** Modules is a singleton which holds compiled services and adapters for all tenants */
export class Modules {
    // keyed by source as full url with domain or file path
    services: Record<string, Service> = {};
    adapterConstructors: Record<string, AdapterConstructor>= {};
    serviceManifests: Record<string, IServiceManifest> = {};
    adapterManifests: Record<string, IAdapterManifest> = {};

    // These map domain to the full url on that domain (or file path) of the service/adapter
    servicesMap: Record<string, string[]> = {};
    adapterConstructorsMap: Record<string, string[]> = {};
    serviceManifestsMap: Record<string, string[]> = {};
    adapterManifestsMap: Record<string, string[]> = {};
    manifestsAllLoaded = new Set<string>();


    validateServiceManifest: Validate;
    validateAdapterManifest: Validate;
    // keyed by source as full url with domain or file path
    validateAdapterConfig: Record<string, Validate> = {};
    validateServiceConfig: Record<string, Validate> = {};

    constructor(public defaultValidator: (schema: any) => Validate) {
        this.validateServiceManifest = defaultValidator(schemaIServiceManifest);
        this.validateAdapterManifest = defaultValidator(schemaIAdapterManifest);

        // Built-in implementations are loaded lazily from literal import maps so bundling can still include them.
        this.adapterConstructors = {};
        this.adapterConstructorsMap[""] = Object.keys(builtInAdapterLoaders);
        this.adapterManifests = {
            "./test/TestConfigFileAdapter.ram.json": TestConfigFileAdapterManifest,
            "./adapter/LocalFileAdapter.ram.json": LocalFileAdapterManifest,
            "./adapter/S3FileAdapter.ram.json": S3FileAdapterManifest,
            "./adapter/NunjucksTemplateAdapter.ram.json": NunjucksTemplateAdapterManifest,
            "./adapter/SimpleProxyAdapter.ram.json": SimpleProxyAdapterManifest,
            "./adapter/AWS4ProxyAdapter.ram.json": AWS4ProxyAdapterManifest,
            "./adapter/ElasticProxyAdapter.ram.json": ElasticProxyAdapterManifest,
            "./adapter/ElasticDataAdapter.ram.json": ElasticDataAdapterManifest,
            "./adapter/ElasticQueryAdapter.ram.json": ElasticQueryAdapterManifest,
            "./adapter/FileLogReaderAdapter.ram.json": FileLogReaderAdapterManifest,
            "./adapter/SnsSmsAdapter.ram.json": SnsSmsAdapterManifest,
            "./adapter/BotProxyAdapter.ram.json": BotProxyAdapterManifest,
            "./adapter/BinanceProxyAdapter.ram.json": BinanceProxyAdapterManifest,
            "./adapter/MongoDbDataAdapter.ram.json": MongoDbDataAdapterManifest,
            "./adapter/MongoDbQueryAdapter.ram.json": MongoDbQueryAdapterManifest,
            "./adapter/IMAPAdapter.ram.json": IMAPAdapterManifest,
        };
        this.adapterManifestsMap[""] = Object.keys(this.adapterManifests);

        Object.entries(this.adapterManifests).forEach(([url, v]) => {
            (v as any).source = url;
            this.validateAdapterConfig[url] = defaultValidator(this.adapterManifests[url].configSchema || {});
        });

        this.services = {};
        this.servicesMap[""] = Object.keys(builtInServiceLoaders);

        this.serviceManifests = {
            "./services/mock.rsm.json": MockManifest,
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
            "./services/temporary-access.rsm.json": TemporaryAccessManifest,
            "./services/query.rsm.json": QueryManifest as unknown as IServiceManifest,
            "./services/csvConverter.rsm.json": CSVConverterManifest as unknown as IServiceManifest,
            "./services/logReader.rsm.json": LogReaderManifest as unknown as IServiceManifest,
            "./services/service-store.rsm.json": ServiceStoreManifest as unknown as IServiceManifest,
            "./services/timer.rsm.json": TimerManifest as unknown as IServiceManifest,
            "./services/sms.rsm.json": SmsManifest as unknown as IServiceManifest,
            "./services/webscraperService.rsm.json": WebScraperManifest as unknown as IServiceManifest,
            "./services/references.rsm.json": ReferencesManifest as unknown as IServiceManifest,
            "./services/timer-store.rsm.json": TimerStoreManifest as unknown as IServiceManifest,
            "./services/server-side-events.rsm.json": serverSideEventsManifest as unknown as IServiceManifest,
            "./services/store-from-query.rsm.json": StoreFromQueryManifest as unknown as IServiceManifest,
            "./services/emailStore.rsm.json": EmailStoreManifest as unknown as IServiceManifest,
            "./services/webhooks.rsm.json": WebhooksManifest as unknown as IServiceManifest,
            "./services/private-caller.rsm.json": PrivateCallerManifest as unknown as IServiceManifest,
            "./services/totp.rsm.json": TotpManifest as unknown as IServiceManifest,
            "./services/logCollector.rsm.json": LogCollectorManifest as unknown as IServiceManifest,
        };
        this.serviceManifestsMap[""] = Object.keys(this.serviceManifests);

        Object.entries(this.serviceManifests).forEach(([url, v]) => {
            (v as any).source = url;
            this.ensureServiceConfigValidator(url);
        });
    }

    addToDomainMap(map: Record<string, string[]>, url: string, tenant: string) {
        const objUrl = new Url(url);
        if (objUrl.domain) {
            map[objUrl.domain] = map[objUrl.domain] || [];
            if (!map[objUrl.domain].includes(url)) {
                map[objUrl.domain].push(url);
            }
        } else {
            map[tenant] = map[tenant] || [];
            if (!map[tenant].includes(url)) {
                map[tenant].push(url);
            }
        }
    }

    /** Remove from cache all code modules stored in a tenant */
    purgeTenantModules(tenant: string) {
        const adapterUrls = this.adapterConstructorsMap[tenant];
        if (adapterUrls) {
            adapterUrls.forEach(url => delete this.adapterConstructors[url]);
            delete this.adapterConstructorsMap[tenant];
        }
        const serviceUrls = this.servicesMap[tenant];
        if (serviceUrls) {
            serviceUrls.forEach(url => delete this.services[url]);
            delete this.servicesMap[tenant];
        }
    }

    async getConfigAdapter(tenant: string) {
        const configStoreAdapterSpec = { ...config.server.infra[config.server.configStore] };
        (configStoreAdapterSpec as Infra & { basePath: '/' }).basePath = "/";
        const context = makeServiceContext(tenant, nullState);
        const configAdapter = await config.modules.getAdapter<IFileAdapter>(configStoreAdapterSpec.adapterSource, context, configStoreAdapterSpec);
        return configAdapter;
    }

    /**
     * Load an adapter as a module and return the constructor
     * @param sourceUrl relative or absolute url to the adapter source, or './' for built ins
     * @param manifestUrl the url of the manifest that references the adapter
     * @returns the adapter constructor
     */
    async getAdapterConstructor<T extends IAdapter>(sourceUrl: string, tenant: string, manifestUrl?: string, primaryDomain?: string): Promise<new (context: AdapterContext, config: unknown) => T> {
        let moduleReqUrl: Url;
        if (manifestUrl) {
            moduleReqUrl = new Url(this.urlRelativeToManifest(manifestUrl, sourceUrl, "adapter"));
        } else {
            moduleReqUrl = new Url(sourceUrl);
        }
        if (!this.adapterConstructors[sourceUrl]) {
            try {
                const builtInLoader = builtInAdapterLoaders[sourceUrl];
                if (builtInLoader) {
                    const module = await builtInLoader();
                    this.adapterConstructors[sourceUrl] = module.default as AdapterConstructor;
                } else {
                    moduleReqUrl.query['$x-rs-source'] = [ 'internal'];
                    if (moduleReqUrl.domain === primaryDomain) {
                        moduleReqUrl.query['$no-cache'] = [ crypto.randomUUID() ];
                    }
                    const module = await import(moduleReqUrl.toString());
                    this.adapterConstructors[sourceUrl] = module.default;
                }
                this.addToDomainMap(this.adapterConstructorsMap, sourceUrl, tenant);
            } catch (err) {
                throw new Error(`failed to load adapter at ${sourceUrl}: ${err}`);
            }
        }
        return this.adapterConstructors[sourceUrl] as new (context: AdapterContext, config: unknown) => T;
    }

    async getAdapterManifest(url: string, tenant: string, primaryDomain?: string): Promise<IAdapterManifest | string> {
        const fullUrl = config.canonicaliseUrl(url, tenant, primaryDomain);
        if (!this.adapterManifests[fullUrl]) {
            try {
                const manifestJson = await getSource(url, tenant);
                const manifest = JSON.parse(manifestJson);
                manifest.source = url;
                this.adapterManifests[fullUrl] = manifest;
                this.addToDomainMap(this.adapterManifestsMap, url, tenant);
            } catch (err) {
                return `failed to load manifest at ${url}: ${err}`;
            }

            if (!this.validateAdapterManifest(this.adapterManifests[fullUrl] as any)) {
                return `bad format manifest at ${fullUrl}: ${getErrors(this.validateAdapterManifest)}`;
            }

            if (!this.validateAdapterConfig[fullUrl]) {
                this.validateAdapterConfig[fullUrl] = this.defaultValidator(this.adapterManifests[fullUrl].configSchema || {})
            }
        }
        return this.adapterManifests[fullUrl];
    }

    /** returns a new instance of an adapter */
    async getAdapter<T extends IAdapter>(sourceUrl: string, context: AdapterContext, adapterConfig: unknown, primaryDomain?: string): Promise<T> {
        sourceUrl = config.canonicaliseUrl(sourceUrl, context.tenant);
        let manifestUrl;
        if (sourceUrl.split('?')[0].endsWith('.ram.json')) {
            const manifest = await this.getAdapterManifest(sourceUrl, context.tenant, primaryDomain);
            if (typeof manifest === 'string') throw new Error(manifest);
            manifestUrl = sourceUrl;
            sourceUrl = manifest.moduleUrl as string;
        }

        context.logger.debug(`Loading adapter at ${sourceUrl}`);
        const constr = await this.getAdapterConstructor(sourceUrl, context.tenant, manifestUrl, primaryDomain);
        return new constr(context, adapterConfig) as T;
    }

    ensureServiceConfigValidator(url: string) {
        if (!this.validateServiceConfig[url]) {
            try {
                let configSchema: Record<string, unknown> = schemaIServiceConfig;
                const serviceManifest = this.serviceManifests[url];
                if (serviceManifest.configSchema) {
                    configSchema = assignProperties(serviceManifest.configSchema, schemaIServiceConfig);                    let resolvedUrl = url;
                    if (resolvedUrl.startsWith('.')) resolvedUrl = 'https://restspace.io/builtin-services' + resolvedUrl.substring(1);
                    configSchema.$id = resolvedUrl;
                }

                this.validateServiceConfig[url] = this.defaultValidator(configSchema);
            } catch (err) {
                throw new Error(`Failed to compile service config validator for ${url}`, err as Error);
            }
        }
    }

    async getServiceManifest(url: string, tenant: string, primaryDomain?: string): Promise<IServiceManifest | string> {
        const fullUrl = config.canonicaliseUrl(url, tenant, primaryDomain);
        if (!this.serviceManifests[fullUrl]) {
            try {
                const manifestJson = await getSource(url, tenant);
                const manifest = JSON.parse(manifestJson);
                manifest.source = url;
                this.serviceManifests[fullUrl] = manifest;
                this.addToDomainMap(this.serviceManifestsMap, url, tenant);
            } catch (err) {
                return `failed to load manifest at ${url}: ${err}`;
            }

            if (!this.validateServiceManifest(this.serviceManifests[fullUrl] as any)) {
                return `bad format manifest at ${fullUrl}: ${getErrors(this.validateServiceManifest)}`;
            }

            this.ensureServiceConfigValidator(fullUrl);
        }
        return this.serviceManifests[fullUrl];
    }

    urlRelativeToManifest(manifestUrl: string, sourceUrl: string | undefined, type: "service" | "adapter") {
        if (manifestUrl.startsWith("https://") && sourceUrl) {
            sourceUrl = new URL(sourceUrl, manifestUrl).toString();
        } else if (manifestUrl.startsWith("/") && sourceUrl) {
            throw new Error('Not allowed to have a site-relative source url for a manifest: ' + manifestUrl);
        } else {
            sourceUrl = sourceUrl || (
                type === "service"
                ? manifestUrl.replace('.rsm.json', '.ts')
                : manifestUrl.replace('.ram.json', '.ts')
            );
        }
        return sourceUrl;
    }

    async getService(url?: string, tenant?: string, primaryDomain?: string): Promise<Service> {
        if (url === undefined || tenant === undefined) {
            return Service.Identity; // returns message unchanged
        }

        url = config.canonicaliseUrl(url, tenant, primaryDomain);

        // pull manifest if necessary
        let sourceUrl = url;
        if (url.split('?')[0].endsWith('.rsm.json')) {
            const manifest = await this.getServiceManifest(url, tenant, primaryDomain);
            if (typeof manifest === 'string') throw new Error(manifest);
            sourceUrl = this.urlRelativeToManifest(url, manifest.moduleUrl, "service");
            if (sourceUrl === undefined) return Service.Identity;
        }

        if (!this.services[sourceUrl]) {
            try {
                config.logger.debug(`Start -- loading service at ${url}`);
                const builtInLoader = builtInServiceLoaders[sourceUrl];
                if (builtInLoader) {
                    const module = await builtInLoader();
                    this.services[sourceUrl] = module.default as Service;
                } else {
                    const moduleReqUrl = new Url(sourceUrl);
                    moduleReqUrl.query['$x-rs-source'] = [ 'internal'];
                    if (moduleReqUrl.domain === primaryDomain) {
                        moduleReqUrl.query['$no-cache'] = [ crypto.randomUUID() ];
                    }
                    const module = await import(moduleReqUrl.toString());
                    this.services[sourceUrl] = module.default;
                }
                this.addToDomainMap(this.servicesMap, sourceUrl, tenant);
                config.logger.debug(`End -- loading service at ${url}`);
            } catch (err) {
                throw new Error(`failed to load module at ${url}: ${err}`);
            }
        }
        return this.services[sourceUrl];
    }

    async loadManifestsFromDomain(domain: string, context: SimpleServiceContext) {
        const urlBase = domain === config.tenants[context.tenant].primaryDomain ? '' : `https://${domain}`;
        const servicesUrl = pathCombine(urlBase, '/.well-known/restspace/services');
        const msg = new Message(servicesUrl, context);
        const resp = await handleOutgoingRequest(msg);
        if (!resp.ok || !resp.data) {
            context.logger.error(`Error reading services from ${servicesUrl}: ${resp.status} ${resp.data?.asStringSync()}`);
        }
        const services = await resp.data?.asJson() as Record<string, { apis?: string[], basePath: string }>;
        this.serviceManifestsMap[domain] = [];
        this.adapterManifestsMap[domain] = [];
        const serviceStoreServices = Object.values(services).filter(s => s.apis?.includes("service-store"));
        for (const s of serviceStoreServices) {
            await this.loadManifestsFromDirectory(pathCombine(urlBase, s.basePath + '/'), context);
        }
        this.manifestsAllLoaded.add(domain);
    }

    async loadManifestsFromDirectory(url: string, context: SimpleServiceContext) {
        url = upToLast(url, '?');
        if (!url.endsWith('/')) throw new Error('Trying to load manifests from a non-directory URL');

        const fetchUrl = url + '?$list=items,recursive';
        const msg = new Message(fetchUrl, context, "GET");
        const resp = await handleOutgoingRequest(msg);
        if (!resp.ok || !resp.data || !resp.data.isDirectory) context.logger.error(`Error loading manifests from ${url}: ${resp.status} ${resp.data?.asStringSync()}`);
        const dir = await resp.data?.asJson() as Record<string, any>;

        const fullUrl = config.canonicaliseUrl(url, context.tenant);
        for (const [key, manifest] of Object.entries(dir)) {
            const itemUrl = fullUrl + key;
            if (key.endsWith('.rsm.json')) {
                try {
                    manifest.source = itemUrl;
                    if (!this.validateServiceManifest(manifest)) {
                        const desc = (this.validateServiceManifest.errors || [])
                            .map((e: any) => `keyword location ${e.keywordLocation} isntance location ${e.instanceLocation}`).join('; ')
                        throw new Error(`bad format manifest at ${itemUrl}: ${desc}`);
                    }

                    this.serviceManifests[itemUrl] = manifest;
                    this.addToDomainMap(this.serviceManifestsMap, itemUrl, context.tenant);
                        
                    this.ensureServiceConfigValidator(itemUrl);
                } catch (err) {
                    context.logger.error(`failed to load manifest at ${itemUrl}: ${err}`);
                }
            } else if (key.endsWith('.ram.json')) {
                try {
                    manifest.source = itemUrl;
                    if (!this.validateAdapterManifest(manifest)) {
                        const desc = (this.validateAdapterManifest.errors || [])
                            .map((e: any) => `keyword location ${e.keywordLocation} instance location ${e.instanceLocation}`).join('; ')
                        throw new Error(`bad format manifest at ${itemUrl}: ${desc}`);
                    }

                    this.adapterManifests[itemUrl] = manifest;
                    this.addToDomainMap(this.adapterManifestsMap, itemUrl, context.tenant);
                    if (!this.validateAdapterConfig[itemUrl]) {
                        this.validateAdapterConfig[itemUrl] = this.defaultValidator(this.adapterManifests[itemUrl].configSchema || {})
                    }
                } catch (err) {
                    context.logger.error(`failed to load manifest at ${itemUrl}: ${err}`);
                }
    
            }
        }
    }
}
