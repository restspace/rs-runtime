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

import TestConfigFileAdapter from "./test/TestConfigFileAdapter.ts";
import TestConfigFileAdapterManifest from "./test/TestConfigFileAdapter.ram.js";
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
import FileLogReaderAdapter from "./adapter/FileLogReaderAdapter.ts";
import FileLogReaderAdapterManifest from "./adapter/FileLogReaderAdapter.ram.js";
import SnsSmsAdapter from "./adapter/SnsSmsAdapter.ts";
import SnsSmsAdapterManifest from "./adapter/SnsSmsAdapter.ram.js";
import BotProxyAdapter from "./adapter/BotProxyAdapter.ts";
import BotProxyAdapterManifest from "./adapter/BotProxyAdapter.ram.js";
import BinanceProxyAdapter from "./adapter/BinanceProxyAdapter.ts";
import BinanceProxyAdapterManifest from "./adapter/BinanceProxyAdapter.ram.js";
import MongoDbDataAdapter from "./adapter/MongoDbDataAdapter.ts";
import MongoDbDataAdapterManifest from "./adapter/MongoDbDataAdapter.ram.js";
import MongoDbQueryAdapter from "./adapter/MongoDbQueryAdapter.ts";
import MongoDbQueryAdapterManifest from "./adapter/MongoDbQueryAdapter.ram.js";

import Mock from "./services/mock.ts";
import MockManifest from "./services/mock.rsm.js";
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
import TemporaryAccess from "./services/temporary-access.ts";
import TemporaryAccessManifest from "./services/temporary-access.rsm.js";
import Query from "./services/query.ts";
import QueryManifest from "./services/query.rsm.js";
import CSVConverter from "./services/csvConverter.ts";
import CSVConverterManifest from "./services/csvConverter.rsm.js";
import LogReader from "./services/logReader.ts";
import LogReaderManifest from "./services/logReader.rsm.js";
import ServiceStoreManifest from "./services/service-store.rsm.js"
import Timer from "./services/timer.ts";
import TimerManifest from "./services/timer.rsm.js";
import Sms from "./services/sms.ts";
import SmsManifest from "./services/sms.rsm.js";
import WebScraper from "./services/webScraperService.ts";
import WebScraperManifest from "./services/webScraperService.rsm.js";
import References from "./services/references.ts";
import ReferencesManifest from "./services/references.rsm.js";
import TimerStore from "./services/timer-store.ts";
import TimerStoreManifest from "./services/timer-store.rsm.js";
import ServerSideEvents from "./services/server-side-events.ts";
import serverSideEventsManifest from "./services/server-side-events.rsm.js";
import StoreFromQuery from "./services/store-from-query.ts";
import StoreFromQueryManifest from "./services/store-from-query.rsm.js";

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

        // Statically load core services & adapters
        this.adapterConstructors = {
            "./test/TestConfigFileAdapter.ts": TestConfigFileAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/LocalFileAdapter.ts": LocalFileAdapter,
            "./adapter/S3FileAdapter.ts": S3FileAdapter,
            "./adapter/NunjucksTemplateAdapter.ts": NunjucksTemplateAdapter,
            "./adapter/SimpleProxyAdapter.ts": SimpleProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/AWS4ProxyAdapter.ts": AWS4ProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/ElasticProxyAdapter.ts": ElasticProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/ElasticDataAdapter.ts": ElasticDataAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/ElasticQueryAdapter.ts": ElasticQueryAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/FileLogReaderAdapter.ts": FileLogReaderAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/SnsSmsAdapter.ts": SnsSmsAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/BotProxyAdapter.ts": BotProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/BinanceProxyAdapter.ts": BinanceProxyAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/MongoDbDataAdapter.ts": MongoDbDataAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
            "./adapter/MongoDbQueryAdapter.ts": MongoDbQueryAdapter as new (context: AdapterContext, props: unknown) => IAdapter,
        };
        this.adapterConstructorsMap[""] = Object.keys(this.adapterConstructors);
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
        };
        this.adapterManifestsMap[""] = Object.keys(this.adapterManifests);

        Object.entries(this.adapterManifests).forEach(([url, v]) => {
            (v as any).source = url;
            this.validateAdapterConfig[url] = defaultValidator(this.adapterManifests[url].configSchema || {});
        });

        this.services = {
            "./services/mock.ts": Mock,
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
            "./services/temporary-access.ts": TemporaryAccess as unknown as Service<IAdapter, IServiceConfig>,
            "./services/query.ts": Query as unknown as Service<IAdapter, IServiceConfig>,
            "./services/csvConverter.ts": CSVConverter as unknown as Service<IAdapter, IServiceConfig>,
            "./services/logReader.ts": LogReader as unknown as Service<IAdapter, IServiceConfig>,
            "./services/timer.ts": Timer as unknown as Service<IAdapter, IServiceConfig>,
            "./services/sms.ts": Sms as unknown as Service<IAdapter, IServiceConfig>,
            "./services/webScraperService.ts": WebScraper as unknown as Service<IAdapter, IServiceConfig>,
            "./services/references.ts": References as unknown as Service<IAdapter, IServiceConfig>,
            "./services/timer-store.ts": TimerStore as unknown as Service<IAdapter, IServiceConfig>,
            "./services/server-side-events.ts": ServerSideEvents as unknown as Service<IAdapter, IServiceConfig>,
            "./services/store-from-query.ts": StoreFromQuery as unknown as Service<IAdapter, IServiceConfig>,
        };
        this.servicesMap[""] = Object.keys(this.services);

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
                moduleReqUrl.query['$x-rs-source'] = [ 'internal'];
                if (moduleReqUrl.domain === primaryDomain) {
                    moduleReqUrl.query['$no-cache'] = [ crypto.randomUUID() ];
                }
                const module = await import(moduleReqUrl.toString());
                this.adapterConstructors[sourceUrl] = module.default;
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
                const moduleReqUrl = new Url(sourceUrl);
                moduleReqUrl.query['$x-rs-source'] = [ 'internal'];
                if (moduleReqUrl.domain === primaryDomain) {
                    moduleReqUrl.query['$no-cache'] = [ crypto.randomUUID() ];
                }
                const module = await import(moduleReqUrl.toString());
                this.services[sourceUrl] = module.default;
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
