import { Source } from "rs-core/Source.ts";
import { Url } from "rs-core/Url.ts";
import { Message } from "rs-core/Message.ts";
import { ServiceFactory } from "./ServiceFactory.ts";
import { AuthService } from "rs-core/Service.ts";
import { IChordServiceConfig, IServiceConfig, PrePost } from "rs-core/IServiceConfig.ts";
import { config } from "./config.ts";
import { AuthUser } from "./auth/AuthUser.ts";
import { IChord } from "./IChord.ts";
import { after, deepEqualIfPresent, mergeDeep, upTo } from "rs-core/utility/utility.ts";
import { getErrors } from "rs-core/utility/errors.ts";
import { makeServiceContext } from "./makeServiceContext.ts";
import { SimpleServiceContext, StateClass, nullState, BaseStateClass, BaseContext } from "rs-core/ServiceContext.ts";
import { applyServiceConfigTemplate } from "./Modules.ts";

export interface IServicesConfig {
    services: Record<string, IServiceConfig>;
    authServicePath?: string;
}

export interface IRawServicesConfig extends IServicesConfig {
    chords?: Record<string, IChord>;
    defaults?: Record<string, unknown>;
}

const baseChord: IChord = {
    id: 'sys.base',
    newServices: [
        {
            "access": { "readRoles": "all", "writeRoles": "A" },
            "name": "Services Service",
            "source": "./services/services.rsm.json",
            "basePath": "/.well-known/restspace"
        }
    ]
}

export class Tenant {
    serviceFactory: ServiceFactory
    authService?: AuthService;
    authServiceConfig?: IServiceConfig;
    servicesConfig = null as IServicesConfig | null;
    chordMap: Record<string, Record<string, string>> = {};
    _state: Record<string, BaseStateClass> = {};
    readyBasePaths: string[] = [];

    state = (basePath: string) => async <T extends BaseStateClass>(cons: StateClass<T>, context: BaseContext, config: unknown) => {
        const stateKey = `${basePath}#${cons.name}`;
        if (this._state[stateKey] === undefined) {
            const newState = new cons();
            this._state[stateKey] = newState;
            await newState.load(context, config);
        }
        if (!(this._state[stateKey] instanceof cons)) throw new Error('Changed type of state attached to service');
        return this._state[stateKey] as T;
    }

    get primaryDomain() {
        const name = this.name === "main" ? '' : this.name;
        return this.domains[0] || (name + '.' + config.server.mainDomain);
    }

    get isEmpty() {
        return Object.keys(this.rawServicesConfig.services).length === 0;
    }
    
    constructor(public name: string, public rawServicesConfig: IRawServicesConfig, public domains: string[]) {
        const primaryDomain = domains[0] || ((name === 'main' ? '' : name + '.') + config.server.mainDomain);
        this.serviceFactory = new ServiceFactory(name, primaryDomain);
    }

    private getSources(serviceRecord: Record<string, IServiceConfig> | IServiceConfig[] | IChordServiceConfig[]) {
        return Array.isArray(serviceRecord)
            ? serviceRecord.map(serv => serv.source)
            : Object.values(serviceRecord).map(serv => serv.source);
    }

    private extractSources(rawServicesConfig: IRawServicesConfig) {
        return [
            ...this.getSources(rawServicesConfig.services),
            ...[ ...Object.values(rawServicesConfig?.chords || {}), baseChord ]
                .flatMap(chord => [
                    ...this.getSources(chord.newServices || [])
                ])
        ];
    }

    private sourceIsLocalHttp(source: string) {
        if (source.startsWith('/')) return true;
        if (source.startsWith('http://') || source.startsWith('https://')) {
            const domain = upTo(after(source, '://'), '/');
            return this.domains.includes(domain);
        }
        return false;
    }

    private filterConfigByLocalSource(rawServicesConfig: IRawServicesConfig, isLocal: boolean) {
        const servicesEntries = Object.entries(rawServicesConfig.services);
        const filteredConfig = {
            ...rawServicesConfig,
            services: Object.fromEntries(
                servicesEntries.filter(([,s]) => isLocal === !!(
                    this.sourceIsLocalHttp(s.source)
                    || (s.adapterSource && this.sourceIsLocalHttp(s.adapterSource))
                ))
            )
        } as IRawServicesConfig;
        if (rawServicesConfig.chords) {
            const chordEntries = Object.entries(rawServicesConfig.chords);
            filteredConfig.chords = Object.fromEntries(
                chordEntries.filter(([,c]) => isLocal === c.newServices?.some(s => this.sourceIsLocalHttp(s.source)))
            );
        }
        return filteredConfig;
    }

    private async applyChord(services: Record<string, IServiceConfig>, chordKey: string, chord: IChord) {
        this.chordMap[chordKey] = {};
        for (const service of chord.newServices || []) {
            if (!config.validateChordService(service)) {
                throw new Error(`Chord ${chord['id']} service ${service['name'] || '<unnamed>'} was misformatted: ${getErrors(config.validateChordService)}` );
            }
            if (services[service.basePath]) {
                const matchService = { ...service } as any;
                delete matchService.name;
                delete matchService.localDir;
                if (!deepEqualIfPresent(services[service.basePath], matchService)) {
                    throw new Error(`chord ${chord.id} chord key ${chordKey} fails to match existing service on ${service.basePath}`);
                }
            } else {
                const newService = this.applyDefaults(service);
                if (!(newService.infraName || newService.adapterSource)) {
                    // We need to find an infra for the service as none was specified
                    const manifest = this.serviceFactory.serviceManifestsBySource[newService.source];
                    if (manifest.adapterInterface) {
                        const infraName = await this.serviceFactory.infraForAdapterInterface(manifest.adapterInterface);
                        if (!infraName) {
                            throw new Error(`chord ${chord.id} chord key ${chordKey} service ${service.name} requires infraName or adapterSource property to be manually set`);
                        }
                        newService.infraName = infraName;
                    }
                }
                services[service.basePath] = newService as IServiceConfig;
            }
            this.chordMap[chordKey][service.name] = service.basePath;
        }
    }

    private applyDefaults<T extends IServiceConfig | IChordServiceConfig>(service: T): T {
        const defaults = this.serviceFactory.serviceManifestsBySource[service.source].defaults;
        if (!defaults) return service;
        // defaults is by reference, create a new copy to avoid overwriting original 
        const defaultedService = structuredClone(defaults);
        mergeDeep(defaultedService, service);
        return defaultedService as T;
    }

    private applyTemplate<T extends IServiceConfig>(service: T): T {
        const template = this.serviceFactory.serviceManifestsBySource[service.source].configTemplate;
        if (!template) return service;
        const serviceFromTemplate = applyServiceConfigTemplate(service, template);
        return serviceFromTemplate as T;
    }

    private async buildServicesConfig(rawServicesConfig: IRawServicesConfig): Promise<IServicesConfig> {
        const services = { ...rawServicesConfig.services };
        Object.keys(services).forEach(k => {
            services[k] = this.applyDefaults(services[k]);
            services[k] = this.applyTemplate(services[k]);
        });

        const servicesConfig: IServicesConfig = {
            services,
            authServicePath: rawServicesConfig.authServicePath
         };

        // set up universally required services in the baseChord
        await this.applyChord(servicesConfig.services, "base", baseChord);
        for (const [chordKey, chord] of Object.entries(rawServicesConfig.chords || {})) {
            await this.applyChord(servicesConfig.services, chordKey, chord);
        }
        Object.keys(servicesConfig.services).forEach(keyPath => servicesConfig.services[keyPath].basePath = keyPath);
        return servicesConfig;
    }

    async loadConfig(rawServicesConfig: IRawServicesConfig, oldTenant?: Tenant) {
        // we need the service manifests for their default values before building servicesConfig
        await this.serviceFactory.loadServiceManifests(this.extractSources(rawServicesConfig));

        const newServicesConfig = await this.buildServicesConfig(rawServicesConfig);
        if (this.servicesConfig === null) {
            this.servicesConfig = newServicesConfig;
        } else {
            this.servicesConfig = {
                services: { ...this.servicesConfig.services, ...newServicesConfig.services },
                authServicePath: this.servicesConfig.authServicePath || newServicesConfig.authServicePath
            };
        }

        if (this.serviceFactory.serviceConfigs === null) {
            this.serviceFactory.serviceConfigs = this.servicesConfig.services;
        } else {
            this.serviceFactory.serviceConfigs = { ...this.serviceFactory.serviceConfigs, ...this.servicesConfig.services };
        }

        await this.serviceFactory.loadAdapterManifests();

        // init state for the services here
        await Promise.all(Object.values(newServicesConfig.services).map(config => {
            const context = makeServiceContext(this.name, this.state(config.basePath));
            return this.serviceFactory.initService(config, context, oldTenant?._state[config.basePath])
                .catch(reason => {
                    throw new Error(`Service ${config.name} failed to initialize: ${reason}`);
                });
        })).catch((reason) => {
            config.logger.error(`Failed to init all services, ${reason}`, this.name);
            throw new Error(`${reason}`);
        });

        if (!this.authService) {
            const res = await this.serviceFactory.getServiceAndConfigByApi("auth");
            if (res) {
                const [ authService, authServiceConfig ] = res;
                this.authService = authService as AuthService;
                this.authServiceConfig = authServiceConfig;
            }
        }
    }

    pathIsReady(url: Url): boolean {
        const basePath = this.serviceFactory.basePathFromUrl(url);
        return !!basePath && this.readyBasePaths.includes(basePath);
    }

    async init(oldTenant?: Tenant) {
        await this.loadConfig(this.filterConfigByLocalSource(this.rawServicesConfig, false), oldTenant);
        this.readyBasePaths = Object.keys(this.filterConfigByLocalSource(this.rawServicesConfig, false).services);
        await this.loadConfig(this.filterConfigByLocalSource(this.rawServicesConfig, true), oldTenant);
    }

    async unload(newTenant: Tenant) {
        await Promise.allSettled(Object.entries(this._state).map(([key, cls]) => {
            const newState = newTenant._state[key];
            // check newState is the same class as cls
            if (newState && newState.constructor.name === cls.constructor.name) {
                cls.unload(newState);
            } else {
                cls.unload();
            }
        }));
    }

    getMessageFunctionByUrl(url: Url, source: Source) {
        // we assign the state in serviceFactory as we don't know the basePath yet

        return this.serviceFactory.getMessageFunctionByUrl(url, makeServiceContext(this.name, nullState), this.state, source);
    }

    getMessageFunctionForService(serviceConfig: IServiceConfig, source: Source, prePost?: PrePost) {
        return this.serviceFactory.getMessageFunctionForService(serviceConfig, makeServiceContext(this.name, this.state(serviceConfig.basePath), prePost), source);
    }

    async attachUser(msg: Message) {
        if (this.authService) {
            msg = await this.authService.setUserFunc(msg, makeServiceContext(this.name, this.state(this.authServiceConfig!.basePath)), this.authServiceConfig as IServiceConfig);
        }
        if (!msg.user) {
            msg.user = AuthUser.anon;
            msg.authenticated = false;
        }
        return msg;
    }
}
