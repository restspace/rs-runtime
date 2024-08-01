import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { schemaIServiceConfig, schemaIServiceConfigExposedProperties } from "rs-core/IServiceConfig.ts";
import { config, Infra } from "../config.ts";
import { IAdapterManifest, IServiceManifest } from "rs-core/IManifest.ts";
import { IRawServicesConfig, Tenant } from "../tenant.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { IChord } from "../IChord.ts";
import { getErrors } from "rs-core/utility/errors.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { ApiPattern } from "rs-core/DirDescriptor.ts";
import { storeApi } from "../openApi.ts";
import { Url } from "../../rs-core/Url.ts";

type InfraDetails = Record<string, unknown> & Infra;

const catalogue: Record<string, {
    services: Record<string, IServiceManifest & { source: string }>,
    adapters: Record<string, IAdapterManifest & { source: string }>,
    infra?: Record<string, InfraDetails>
}> = {};

const deleteManifestProperties = [ 'exposedConfigProperties' ];

const service = new Service();

const serviceManifestAsCatalogue = (entry: [string, IServiceManifest]) => {
    const [name, serviceManifest] = entry;
    const manifest = { ...serviceManifest } as (IServiceManifest & { source: string });
    deleteManifestProperties.forEach(prop => delete (manifest as any)[prop]);
    manifest.source = name;
    return [name, manifest] as [string, IServiceManifest & { source: string }];
}

const adapterManifestAsCatalogue = (entry: [string, IAdapterManifest]) => {
    const [name, adapterManifest] = entry;
    const manifest = adapterManifest as IAdapterManifest & { source: string };
    manifest.source = name;
    return [name, manifest] as [string, IAdapterManifest & { source: string }];
}

const infraAsCatalogue = (entry: [string, InfraDetails]) => {
    const [name, infra] = entry;
    return [name, {
        adapterSource: infra.adapterSource,
        preconfigured: Object.keys(infra).filter(k => k !== 'adapterSource')
    }] as [string, { adapterSource: string, preconfigured: string[] }];
}

const fetchDomainCatalogue = (domainOrTenant: string) => {
    const serviceManifests = (config.modules.serviceManifestsMap[domainOrTenant] || [])
        .map(url => [url, config.modules.serviceManifests[url]] as [string, IServiceManifest]);
    const adapterManifests = (config.modules.adapterManifestsMap[domainOrTenant] || [])
        .map(url => [url, config.modules.adapterManifests[url]] as [string, IAdapterManifest]);
    return {
        services: Object.fromEntries(serviceManifests.map(serviceManifestAsCatalogue)),
        adapters: Object.fromEntries(adapterManifests.map(adapterManifestAsCatalogue))
    };
}

const tenantOrUrlToDomain = (dir: string) => {
    if (dir === '') return dir;

    if (dir.startsWith('http://') || dir.startsWith('https://')) return new Url(dir).domain;
    
    const domain = config.tenants[dir]?.primaryDomain;
    if (!domain) throw new Error(`No tenant or domain found for ${dir}`);
    return domain;
}

// @TODO ensure this does not break if a domain is unavailable
const ensureAllManifests = async (tenantOrUrl: string, context: SimpleServiceContext) => {
    const domain = tenantOrUrlToDomain(tenantOrUrl);
    if (catalogue[domain]) return domain;

    if (tenantOrUrl === "") {
        catalogue[domain] = {
            services: Object.fromEntries(Object.entries(config.modules.serviceManifests).map(serviceManifestAsCatalogue)),
            adapters: Object.fromEntries(Object.entries(config.modules.adapterManifests).map(adapterManifestAsCatalogue)),
            infra: Object.fromEntries(Object.entries(config.server.infra as Record<string, InfraDetails>).map(infraAsCatalogue))
        }
    } else {
        await config.modules.loadManifestsFromDomain(domain, context);
        catalogue[domain] = fetchDomainCatalogue(domain);
    }

    return domain;
};

service.constantDirectory('/', {
    path: '/',
    paths: [
        [ 'catalogue', undefined, { pattern: 'view', respMimeType: 'application/json' } ],
        [ 'services', undefined, { pattern: 'view', respMimeType: 'application/json' } ],
        [ 'raw', undefined, { pattern: 'store', createDirectory: false, createFiles: false, storeMimeTypes: [ 'application/json' ]}],
        [ 'raw.json', undefined, { pattern: 'store', createDirectory: false, createFiles: false, storeMimeTypes: [ 'application/json' ]}]
    ],
    spec: {
        pattern: 'directory'
    }
});

service.getPath('catalogue', async (msg, context) => {
    // load basic manifest set
    const builtIns = "";
    const local = context.tenant;
    const extLibs = [ "https://lib.restspace.io" ]
        .filter(lib => config.tenants[context.tenant].primaryDomain !== new Url(lib).domain);
    await ensureAllManifests(builtIns, context);
    const localDomain = await ensureAllManifests(local, context);

    const baseSchema = schemaIServiceConfig;
    const allCat = {
        services: {
            ...catalogue[builtIns].services,
            ...catalogue[localDomain].services
        },
        adapters: {
            ...catalogue[builtIns].adapters,
            ...catalogue[localDomain].adapters
        },
        infra: { ...catalogue[builtIns].infra }
    };

    
    for (const lib of extLibs) {
        const domain = await ensureAllManifests(lib, context);
        allCat.services = { ...allCat.services, ...(catalogue[domain]?.services || {}) };
        allCat.adapters = { ...allCat.adapters, ...(catalogue[domain]?.adapters || {})};
    }

    (baseSchema.properties.source as any).enum = Object.values(allCat.services).map(serv => serv.source);

    return Promise.resolve(msg.setDataJson({ baseSchema, catalogue: allCat }));
});

service.getPath('services', async (msg: Message, context: SimpleServiceContext) => {
    const tenant = config.tenants[context.tenant];

    // pull additionExposedProperties for all services
    const manifestData: Record<string, Partial<IServiceManifest>> = {};
    for (const serv of Object.values(tenant.servicesConfig!.services)) {
        if (!manifestData[serv.source]) {
            const manifest = await config.modules.getServiceManifest(serv.source, tenant.name);
            if (typeof manifest === 'string') {
                context.logger.error(`Failed to get manifest for service ${serv.source}: ${manifest}`);
                return msg.setStatus(500, 'Server error');
            }
            manifestData[serv.source] = {
                exposedConfigProperties: manifest.exposedConfigProperties || [],
                apis: manifest.apis
            }
        }
    }

    // create list of service configs with only exposed properties
    const services: Record<string, Record<string, unknown>> = {};
    Object.entries(tenant.servicesConfig!.services).forEach(([ basePath, service ]) => {
        const sanitisedService:Record<string, unknown> = {};
        const exposedProperties = schemaIServiceConfigExposedProperties.concat(manifestData[service.source].exposedConfigProperties || []);
        Object.entries(service)
            .filter(([k]) => exposedProperties.includes(k))
            .forEach(([k, v]) => sanitisedService[k] = v);
        sanitisedService['apis'] = manifestData[service.source].apis;
        services[basePath] = sanitisedService;
    });

    return msg.setDataJson(services);
});

const getRaw = (msg: Message, context: SimpleServiceContext) => {
    const tenant = config.tenants[context.tenant];

    return Promise.resolve(msg.setDataJson(tenant.rawServicesConfig));
};

service.getPath('raw', getRaw);
service.getPath('raw.json', getRaw);

const rebuildConfig = async (rawServicesConfig: IRawServicesConfig, tenant: string): Promise<[ number, string ]> => {
    // Remove cached code from this tenant so that all code stored on the tenant is reloaded to latest version
    config.modules.purgeTenantModules(config.tenants[tenant].primaryDomain);

    let newTenant: Tenant;
    try {
        newTenant = new Tenant(tenant, rawServicesConfig, config.tenants[tenant].domains);
        await newTenant.init();
    } catch (err) {
        return [ 400, `Bad config for tenant ${tenant}: ${err}` ];
    }
    try {
        await config.tenants[tenant].unload(newTenant);
    } catch (err) {
        config.logger.error(`Failed to unload tenant ${tenant} successfully, resources may have been leaked`, tenant);
    }
    config.tenants[tenant] = newTenant;

    // return before this promise completes: we want to write back in the background
    (async () => {
        try {
            const configAdapter = await config.modules.getConfigAdapter(tenant);
            await configAdapter.write('services.json', MessageBody.fromObject(rawServicesConfig));
        } catch (err) {
            config.logger.error(`Failed to write back tenant config: ${tenant}`, tenant);
        }
    })();

    return [ 0, '' ];
}

const putRaw = async (msg: Message, context: SimpleServiceContext) => {
    const rawServicesConfig = await msg?.data?.asJson() as IRawServicesConfig;
    const [ status, message ] = await rebuildConfig(rawServicesConfig, context.tenant);
    if (status) return msg.setStatus(status, message);

    return msg.setStatus(200);
};

service.putPath('raw', putRaw);
service.putPath('raw.json', putRaw);

const putChords = async (msg: Message, context: SimpleServiceContext) => {
    const chords = await msg?.data?.asJson() as Record<string, IChord>;
    if (typeof chords !== 'object') return msg.setStatus(400, 'Chords should be an object labelled by chord id');
    const tenant = config.tenants[context.tenant];

    const tenantChords = { ...(tenant.rawServicesConfig.chords || {}) };
    for (const chord of Object.values(chords)) {
        if (!config.validateChord(chord as any)) {
            const errors = getErrors(config.validateChord);
            return msg.setStatus(400, chord['id']
                ? `Chord ${chord['id']} was misformatted: ${errors}`
                : 'A chord was misformatted');
        }
        tenantChords[chord.id] = chord;
    }

    const newRawConfig = {
        services: { ...tenant.rawServicesConfig.services },
        authServicePath: tenant.rawServicesConfig.authServicePath,
        chords: tenantChords
    };

    const [ status, message ] = await rebuildConfig(newRawConfig, context.tenant);
    return msg.setStatus(status || 200, message);
}

service.putPath('chords', putChords);
service.putPath('chords.json', putChords);

const getChordMap = (msg: Message, context: SimpleServiceContext) => {
    const tenant = config.tenants[context.tenant];

    return Promise.resolve(msg.setDataJson(tenant.chordMap));
}

service.getPath('chord-map', getChordMap);
service.getPath('chord-map.json', getChordMap);

const openApi = async (msg: Message, context: SimpleServiceContext) => {
    const tenant = config.tenants[context.tenant];

    const spec = {
        openApi: "3.0.3",
        info: {
            title: tenant.name,
            description: 'Restspace API',
            version: "1.0.0"
        },
        paths: {
        } as Record<string, unknown>,
        components: {
        } as Record<string, unknown>,
        externalDocs: {
            description: "Services documentation",
            url: "https://restspace.io/docs/services"
        }
    };

    // pull additionExposedProperties for all services
    const manifestData: Record<string, Partial<IServiceManifest>> = {};
    for (const serv of Object.values(tenant.servicesConfig!.services)) {
        if (!manifestData[serv.source]) {
            const manifest = await config.modules.getServiceManifest(serv.source, context.tenant);
            if (typeof manifest === 'string') return msg.setStatus(500, 'Server error');
            let apiPattern: ApiPattern = "store";
            if (manifest.apis?.includes('store-transform')) apiPattern = "store-transform"
            else if (manifest.apis?.includes('transform')) apiPattern = "transform"
            else if (manifest.apis?.includes('view')) apiPattern = "view"
            else if (manifest.apis?.includes('operation')) apiPattern = "operation";

            switch (apiPattern) {
                case "store":
                    spec.paths[serv.basePath + '/{servicePath}'] = storeApi(manifest);
                    break;
            }
        }
    }

    return msg.setDataJson(spec);
}

service.getPath('openApi', openApi);

export default service;