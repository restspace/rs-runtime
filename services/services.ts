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

type InfraDetails = Record<string, unknown> & Infra;

let catalogue: {
    services: Record<string, IServiceManifest & { source: string }>,
    adapters: Record<string, IAdapterManifest & { source: string }>,
    infra: Record<string, InfraDetails>
} | null = null;

const deleteManifestProperties = [ 'exposedConfigProperties' ];

const service = new Service();

service.getPath('catalogue', (msg: Message) => {
    if (catalogue === null) {
        catalogue = { services: {}, adapters: {}, infra: {} };
        for (const [ name, serviceManifest ] of Object.entries(config.modules.serviceManifests)) {
            const manifest = { ...serviceManifest } as (IServiceManifest & { source: string });
            deleteManifestProperties.forEach(prop => delete (manifest as any)[prop]);
            manifest.source = name;
            catalogue.services[manifest.name] = manifest;
        }
        for (const [ name, adapterManifest ] of Object.entries(config.modules.adapterManifests)) {
            const manifest = adapterManifest as IAdapterManifest & { source: string };
            manifest.source = name;
            catalogue.adapters[manifest.name] = manifest;
        }
        for (const [name, infra] of Object.entries(config.server.infra as Record<string, InfraDetails>)) {
            catalogue.infra[name] = {
                adapterSource: infra.adapterSource,
                preconfigured: Object.keys(infra).filter(k => k !== 'adapterSource')
            };
        }
    }

    const baseSchema = schemaIServiceConfig;
    (baseSchema.properties.source as any).enum = Object.values(catalogue.services).map(serv => serv.source);

    return Promise.resolve(msg.setDataJson({ baseSchema, catalogue }));
});

service.getPath('services', async (msg: Message, context: SimpleServiceContext) => {
    const tenant = config.tenants[context.tenant];

    // pull additionExposedProperties for all services
    const manifestData: Record<string, Partial<IServiceManifest>> = {};
    for (const serv of Object.values(tenant.servicesConfig!.services)) {
        if (!manifestData[serv.source]) {
            const manifest = await config.modules.getServiceManifest(serv.source, tenant.name);
            if (typeof manifest === 'string') return msg.setStatus(500, 'Server error');
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
        if (!config.validateChord(chord)) {
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
            if (manifest.apis?.includes('store-transform')) apiPattern = "storeTransform"
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