import { Source } from "rs-core/Source.ts";
import { Url } from "rs-core/Url.ts";
import { Message } from "rs-core/Message.ts";
import { ServiceFactory } from "./ServiceFactory.ts";
import { AuthService } from "rs-core/Service.ts";
import { IChordServiceConfig, IServiceConfig, PrePost } from "rs-core/IServiceConfig.ts";
import { config } from "./config.ts";
import { AuthUser } from "./auth/AuthUser.ts";
import { IChord } from "./IChord.ts";
import { deepEqualIfPresent, mergeDeep } from "rs-core/utility/utility.ts";
import { getErrors } from "rs-core/utility/errors.ts";
import { makeServiceContext } from "./makeServiceContext.ts";

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

    get primaryDomain() {
        const name = this.name === "main" ? '' : this.name;
        return this.domains[0] || (name + '.' + config.server.mainDomain);
    }
    
    constructor(public name: string, public rawServicesConfig: IRawServicesConfig, public domains: string[]) {
        this.serviceFactory = new ServiceFactory(name);
    }

    private getSources(serviceRecord: Record<string, IServiceConfig> | IServiceConfig[] | IChordServiceConfig[]) {
        return Array.isArray(serviceRecord)
            ? serviceRecord.map(serv => serv.source)
            : Object.values(serviceRecord).map(serv => serv.source);
    }

    private extractSources() {
        return [
            ...this.getSources(this.rawServicesConfig.services),
            ...[ ...Object.values(this.rawServicesConfig?.chords || {}), baseChord ]
                .flatMap(chord => [
                    ...this.getSources(chord.newServices || [])
                ])
        ];
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
        const defaultedService = JSON.parse(JSON.stringify(defaults));
        mergeDeep(defaultedService, service);
        return defaultedService;
    }

    private async buildServicesConfig(rawServicesConfig: IRawServicesConfig): Promise<IServicesConfig> {
        const services = { ...rawServicesConfig.services };
        Object.keys(services).forEach(k => services[k] = this.applyDefaults(services[k]));
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

    async init() {
        // we need the service manifests for their default values before building servicesConfig
        await this.serviceFactory.loadServiceManifests(this.extractSources());

        this.servicesConfig = await this.buildServicesConfig(this.rawServicesConfig);
        this.serviceFactory.serviceConfigs = this.servicesConfig.services;
        await this.serviceFactory.loadAdapterManifests();
        const res = await this.serviceFactory.getServiceAndConfigByApi("auth");
        if (res) {
            const [ authService, authServiceConfig ] = res;
            this.authService = authService as AuthService;
            this.authServiceConfig = authServiceConfig;
        }
    }

    getMessageFunctionByUrl(url: Url, source: Source) {
        return this.serviceFactory.getMessageFunctionByUrl(url, makeServiceContext(this.name), source);
    }

    getMessageFunctionForService(serviceConfig: IServiceConfig, source: Source, prePost?: PrePost) {
        return this.serviceFactory.getMessageFunctionForService(serviceConfig, makeServiceContext(this.name, prePost), source);
    }

    async attachUser(msg: Message) {
        if (this.authService) {
            msg = await this.authService.setUserFunc(msg, makeServiceContext(this.name), this.authServiceConfig as IServiceConfig);
        }
        if (!msg.user) {
            msg.user = AuthUser.anon;
            msg.authenticated = false;
        }
        return msg;
    }
}
