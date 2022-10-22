import { Message } from "rs-core/Message.ts";
import { MessageFunction, Service } from "../rs-core/Service.ts";
import { Source } from "rs-core/Source.ts";
import { Url } from "rs-core/Url.ts";
import { config } from "./config.ts";
import { IServiceConfigTemplate, IServiceConfig, IAccessControl } from "rs-core/IServiceConfig.ts";
import { ServiceWrapper } from "./ServiceWrapper.ts";
import { applyServiceConfigTemplate } from "./Modules.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { getErrors } from "rs-core/utility/errors.ts";
import { IAdapterManifest, IServiceManifest } from "rs-core/IManifest.ts";
import { ServiceContext, SimpleServiceContext } from "../rs-core/ServiceContext.ts";
import { StateFunction } from "./tenant.ts";

interface ITemplateConfigFromManifest {
    serviceConfigTemplates?: Record<string, IServiceConfigTemplate>;
    prePipeline?: Record<string, unknown>;
    postPipeline?: Record<string, unknown>;
}

type GetPrivateManifestsOutput = (string | IServiceManifest)[];

/** Service message function creation and manifest caching for a tenant */
export class ServiceFactory {
    serviceManifestsBySource  = {} as { [ manifestSource: string ]: IServiceManifest };
    adapterManifestsBySource  = {} as { [ manifestSource: string ]: IAdapterManifest };
    serviceConfigs = null as Record<string, IServiceConfig> | null;

    constructor(public tenant: string) {
    }

    /** loads all manifests required by serviceConfigs and resolves private services */
    async loadServiceManifests(serviceManifestSources: string[]) {
        config.logger.debug(`Start -- loading manifests`, this.tenant);
        // get promises to get service manifests
        const uniqueServiceManifestSources = serviceManifestSources.filter((ms, i) => serviceManifestSources.indexOf(ms) === i);
        const getServiceManifestPromises = uniqueServiceManifestSources.map(source => config.modules.getServiceManifest(source));

        const serviceManifests = await Promise.all<string | IServiceManifest>(getServiceManifestPromises);
        const errors = serviceManifests.filter(m => typeof m === 'string') as string[];
        if (errors.length) throw new Error('failed to load service manifests: ' + errors.join('; '));

        uniqueServiceManifestSources.forEach((source, i) =>
            this.serviceManifestsBySource[source] = serviceManifests[i] as IServiceManifest);

        // get private service manifests
        const privateServiceManifests = await this.getPrivateServiceManifests(
            Object.keys(this.serviceManifestsBySource),
            Object.values(this.serviceManifestsBySource)
        );
        const privateServiceErrors = privateServiceManifests.filter(m => typeof m === 'string') as string[];
        if (privateServiceErrors.length) throw new Error('failed to load manifests: ' + privateServiceErrors.join('; '));
    }

    async loadAdapterManifests() {
        // get promises to get adapter manifests
        const adapterManifestSources = Object.values(this.serviceConfigs!)
            .filter(sc => sc.adapterSource)
            .map(sc => sc.adapterSource) as string[];

        const infraNames = Object.values(this.serviceConfigs!)
            .filter(sc => sc.infraName)
            .map(sc => sc.infraName);
        const missingInfraNames = infraNames.filter(i => !config.server.infra[i as string]);
        if (missingInfraNames.length) {
            throw new Error(`tenant ${this.tenant} has infra names that don't exist: ${missingInfraNames.join(', ')}`);
        }
        const adapterInfraManifestSources = infraNames
            .map(i => config.server.infra[i as string].adapterSource) as string[];

        const allAdapterManifestSources = [ ...adapterManifestSources, ...adapterInfraManifestSources];
        const uniqueAdapterManifestSources = allAdapterManifestSources
            .filter((ms, i) => allAdapterManifestSources.indexOf(ms) === i);
        const getAdapterManifestPromises = uniqueAdapterManifestSources
            .map(source => config.modules.getAdapterManifest(source));

        // get all the manifests
        const adapterManifests = await Promise.all<string | IAdapterManifest>(getAdapterManifestPromises);
        const errors = adapterManifests.filter(m => typeof m === 'string') as string[];
        if (errors.length) throw new Error('failed to load adapter manifests: ' + errors.join('; '));

        uniqueAdapterManifestSources.forEach((source, i) => 
            this.adapterManifestsBySource[source] = adapterManifests[i] as IAdapterManifest);

        config.logger.debug(`End -- loading manifests`, this.tenant);
    }

    /** Get the manifests for all the private services of the given list of service manifests */
    private async getPrivateServiceManifests(existingServiceSources: string[], serviceManifests: IServiceManifest[]): Promise<GetPrivateManifestsOutput> {
        if (serviceManifests.length === 0) return [];
        
        // get manifest sources for all the private services of all the serviceManifests
        const privateServiceSources = serviceManifests
            .flatMap(sc => sc.privateServices
                ? Object.values(sc.privateServices).map(ps => ps.source)
                : [])
            .filter(s => !existingServiceSources.includes(s));
        const manifestsLayer0 = await Promise.all(privateServiceSources.map(pss => config.modules.getServiceManifest(pss)));
        // bail on any error
        if (manifestsLayer0.some(m => typeof m === 'string')) return manifestsLayer0;
        privateServiceSources.forEach((source, i) => this.serviceManifestsBySource[source] = manifestsLayer0[i] as IServiceManifest);

        const manifestsOtherLayers = await this.getPrivateServiceManifests(
            [ ...existingServiceSources, ...privateServiceSources ],
            manifestsLayer0 as IServiceManifest[]
        );

        return manifestsLayer0.concat(manifestsOtherLayers);
    }

    private addPrivateServiceConfig(serviceConfig: IServiceConfig, manifest: IServiceManifest): IServiceConfig {
        if (!manifest.privateServices) return serviceConfig;

        const privateServiceConfigs = {} as Record<string, IServiceConfig>;
        Object.entries(manifest.privateServices).forEach(([ name, configTemplate ]) => {
            let innerServiceConfig = applyServiceConfigTemplate(serviceConfig, configTemplate);
            innerServiceConfig.basePath = name;
            const innerManifest = this.serviceManifestsBySource[innerServiceConfig.source];
            innerServiceConfig = this.addPrivateServiceConfig(innerServiceConfig, innerManifest);
            privateServiceConfigs[name] = innerServiceConfig;
        });
        const newServiceConfig = {
            ...serviceConfig,
            manifestConfig: {
                prePipeline: manifest.prePipeline,
                postPipeline: manifest.postPipeline,
                privateServiceConfigs
            }
        } as IServiceConfig;
        return newServiceConfig;
    }

    async infraForAdapterInterface(adapterInterface: string) {
        let infraName = '';
        for (const [ name, infra ] of Object.entries(config.server.infra)) {
            const adapterManifest = await config.modules.getAdapterManifest(infra.adapterSource);
            if (typeof adapterManifest === 'string') {
                config.logger.error('Failed to load adapter manifest: ' + adapterManifest);
            } else if (adapterManifest.adapterInterfaces.includes(adapterInterface)) {
                if (adapterManifest.moduleUrl?.startsWith('./')) {
                    return name;
                } else {
                    infraName = name;
                }
            }
        }
        return infraName;
    }

    async initService(serviceConfig: IServiceConfig, serviceContext: ServiceContext<IAdapter>): Promise<void> {
        const service = await config.modules.getService(serviceConfig.source);
        const manifest = this.serviceManifestsBySource[serviceConfig.source];
        serviceContext.manifest = manifest;
        await service.initFunc(serviceContext, serviceConfig);
    }

    async getMessageFunctionForService(serviceConfig: IServiceConfig, serviceContext: ServiceContext<IAdapter>, source: Source): Promise<MessageFunction> {
        const service = await config.modules.getService(serviceConfig.source);

        const manifest = this.serviceManifestsBySource[serviceConfig.source];
        serviceConfig = this.addPrivateServiceConfig(serviceConfig, manifest);

        const configValidator = config.modules.validateServiceConfig[serviceConfig.source];
        const serviceName = serviceConfig.name;
        if (!configValidator(serviceConfig)) {
            throw new Error(`failed to validate config for service ${serviceName}: ${getErrors(configValidator)}`);
        }

        let adapter: IAdapter | undefined = undefined;
        if (serviceConfig.adapterSource || serviceConfig.infraName) {
            const adapterConfig = { ...serviceConfig.adapterConfig } || {};
            let adapterSource = serviceConfig.adapterSource;
            if (serviceConfig.infraName) {
                const infra = config.server.infra[serviceConfig.infraName];
                adapterSource = infra.adapterSource;
                Object.assign(adapterConfig, infra);
            }

            const validator = config.modules.validateAdapterConfig[adapterSource as string];
            if (!validator(adapterConfig)) {
                throw new Error(`failed to validate adapter config for service ${serviceConfig.name}: ${getErrors(validator)}`);
            }

            adapter = await config.modules.getAdapter(adapterSource as string, serviceContext, adapterConfig);
            serviceContext = { ...serviceContext, manifest, adapter } as ServiceContext<IAdapter>;
        } else {
            serviceContext = { ...serviceContext, manifest };
        }
        const serviceWrapper = new ServiceWrapper(service);
        const sourceServiceFunc = source === Source.External || source === Source.Outer ? serviceWrapper.external(source) : serviceWrapper.internal;

        // protect data sent to func against modification within it
        serviceContext.manifest = structuredClone(serviceContext.manifest);
        const copyServiceConfig = structuredClone(serviceConfig);

        return (msg: Message) => Promise.resolve(sourceServiceFunc(msg, serviceContext, copyServiceConfig));
    }

    attachFilter(url: Url, func: MessageFunction, context: ServiceContext<IAdapter>): MessageFunction {
        const filterUrl = url.query['$filter']?.[0];
        if (filterUrl) {
            const url = new Url(filterUrl);
            const newFunc: MessageFunction = async (msg: Message) => {
                const msg2 = await func(msg);
                msg2.setUrl(url).setMethod('POST');
                return context.makeRequest(msg2, Source.Outer);
            };
            return newFunc;
        } else {
            return func;
        }
    }

    /** select service with longest path match */
    async getMessageFunctionByUrl(url: Url, serviceContext: ServiceContext<IAdapter>, stateByBasePath: (basePath: string) => StateFunction, source: Source): Promise<MessageFunction> {
        if (this.serviceConfigs!['()'] && source === Source.External) {
            // the service with outer basePath (i.e. "()") can only make requests with Source.Outer.
            // Source.External would cause it to recurse. This service should be accessible by anyone who
            // can access the site: Source.Outer delegates auth checking to services it goes on to call.
            const newServiceContext = {
                ...serviceContext,
                makeRequest: (msg: Message) => serviceContext.makeRequest(msg, Source.Outer)
            } as ServiceContext<IAdapter>;
            return this.getMessageFunctionForService(this.serviceConfigs!['()'], newServiceContext, source);
        }

        const pathParts = [ ...url.pathElements ];

        let exactPath = '/' + pathParts.join('/') + '.';
        let serviceConfig = this.serviceConfigs![exactPath];
        if (serviceConfig) return this.getMessageFunctionForService(serviceConfig, serviceContext, source); 

        while (true) {
            exactPath = '/' + pathParts.join('/');
            serviceConfig = this.serviceConfigs![exactPath];
            if (serviceConfig) {
                serviceContext.state = stateByBasePath(exactPath);
                const innerFunc = await this.getMessageFunctionForService(serviceConfig, serviceContext, source);
                return await this.attachFilter(url, innerFunc, serviceContext)
            } else {
                if (pathParts.length === 0) break;
                pathParts.pop();
            }
        }

        return Promise.resolve((msg: Message) => 
            Promise.resolve(
                msg.method === 'OPTIONS'
                ? config.server.setServerCors(msg).setStatus(204)
                : config.server.setServerCors(msg).setStatus(404, 'Not found')
            )
        );
    }

    getServiceConfigByApi(api: string): IServiceConfig | undefined {
        const apiManifests = Object.entries(this.serviceManifestsBySource).filter(([, m]) => (m.apis || []).some(mApi => mApi === api));
        if (apiManifests.length === 0) return undefined;
        const [ manifestSource, ] = apiManifests[0];
        if (!manifestSource) return undefined;
        return Object.values(this.serviceConfigs!).find(config => config.source === manifestSource);
    } 

    async getServiceAndConfigByApi(api: string): Promise<[ Service, IServiceConfig ] | null> {
        const serviceConfig = this.getServiceConfigByApi(api);
        if (!serviceConfig) return null;
        return [ await config.modules.getService(serviceConfig.source), serviceConfig ];
    }
}