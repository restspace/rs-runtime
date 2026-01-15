import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IDataAdapter, IDataFieldFilterableAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { DirDescriptor, StorePattern, storeDescriptor } from "rs-core/DirDescriptor.ts";
import { IReadOnlySchemaAdapter, ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { ItemFile } from "rs-core/ItemMetadata.ts";
import { IServiceConfig, ManualMimeTypes } from "rs-core/IServiceConfig.ts";
import { AuthUser } from "../auth/AuthUser.ts";

interface IDatasetConfig extends IServiceConfig {
    datasetName: string;
    schema?: Record<string, unknown>;
    uploadBaseUrl?: string;
    storePattern?: StorePattern;
    transformMimeTypes?: ManualMimeTypes;
}

const service = new Service<IDataAdapter, IDatasetConfig>();

const getDatasetName = (config: IDatasetConfig): string => {
    const datasetName = config?.datasetName?.trim();
    if (!datasetName) {
        throw new Error('Dataset service requires a non-empty datasetName');
    }
    return datasetName;
};

/** Whether this is a schema adapter */
const isSchema = (adapter: IDataAdapter): adapter is IDataAdapter & IReadOnlySchemaAdapter =>
    (adapter as IDataAdapter & IReadOnlySchemaAdapter).checkSchema !== undefined;
const isWriteSchema = (adapter: IDataAdapter): adapter is IDataAdapter & ISchemaAdapter =>
    (adapter as IDataAdapter & ISchemaAdapter).writeSchema !== undefined;

/** Check if adapter supports data-field filtering for listings */
const isDataFieldFilterable = (adapter: IDataAdapter): adapter is IDataFieldFilterableAdapter =>
    'supportsDataFieldFiltering' in adapter &&
    (adapter as IDataFieldFilterableAdapter).supportsDataFieldFiltering === true;

const normaliseKey = (key: string) => {
    if (key.endsWith('.json')) return key.slice(0, -5);
    return key;
}

function configSchemaInstanceContentType(dataset: string, baseUrl: string): Promise<string> {
    const url = `${baseUrl}/.schema.json`;
    return Promise.resolve(`application/json; schema="${url}"`);
}

service.initializer(async (_context, config) => {
    getDatasetName(config);
});

service.get(async (msg, { adapter }, config) => {
    const datasetName = getDatasetName(config);
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Dataset GET request should have a service path like <key>');
    }

    let [ key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    let schema: Record<string, unknown> | undefined = undefined;

    if (isSchema(adapter) && !config.schema && key.endsWith('.schema')) {
        const schemaOut = await adapter.readSchema(datasetName);
        if (typeof schemaOut === 'number') {
            return msg.setStatus(schemaOut);
        } else {
            schema = schemaOut;
        }
    } else if (key.endsWith('.schema')) {
        schema = config.schema;
    }

    if (schema) {
        const msgOut = msg.setDataJson(schema);
        msgOut.data!.setMimeType('application/schema+json');
        return msgOut;
    }

    const details = await adapter.checkKey(datasetName, key);
    if (details.status === "none") {
        msg.data = undefined;
        return msg.setStatus(404, 'Not found');
    }

    const readRoles = config?.access?.readRoles;
    if (msg.method !== 'HEAD') {
        const val = await adapter.readKey(datasetName, key);
        if (typeof val === 'number') {
            return msg.setStatus(val);
        }

        // Data-field authorization check
        if (msg.user && readRoles) {
            const authUser = new AuthUser(msg.user);
            if (authUser.hasDataFieldRules(readRoles)) {
                if (!authUser.authorizedForDataRecord(val, readRoles, msg.url.servicePath)) {
                    // Return 404 to avoid leaking information about record existence
                    return msg.setStatus(404, 'Not found');
                }
            }
        }

        msg.data = MessageBody.fromObject(val);
        msg.data.dateModified = details.dateModified;
    } else if (msg.user && readRoles) {
        const authUser = new AuthUser(msg.user);
        if (authUser.hasDataFieldRules(readRoles)) {
            const val = await adapter.readKey(datasetName, key);
            if (typeof val === 'number') {
                return msg.setStatus(val);
            }
            if (!authUser.authorizedForDataRecord(val, readRoles, msg.url.servicePath)) {
                // Return 404 to avoid leaking information about record existence
                return msg.setStatus(404, 'Not found');
            }
        }
    }

    let getInstanceContentType = configSchemaInstanceContentType;
    if (isSchema(adapter) && !config.schema) {
        getInstanceContentType = adapter.instanceContentType;
    }
    msg.data!.mimeType = await getInstanceContentType(datasetName, msg.url.baseUrl());

    return msg;
});

service.getDirectory(async (msg, { adapter }, config: IDatasetConfig) => {
    const datasetName = getDatasetName(config);
    if (msg.url.servicePathElements.length !== 0) {
        return msg.setStatus(400, 'Dataset GET directory request should have no service path');
    }

    enum DirState {
        mustCreateSchema,
        createInstanceAdapterSchema,
        createInstanceConfigSchema
    }

    const take = msg.url.query['$take'] ? parseInt(msg.url.query['$take'][0]) : undefined;
    const skip = msg.url.query['$skip'] ? parseInt(msg.url.query['$skip'][0]) : undefined;

    // Check for data-field authorization rules
    const authUser = msg.user ? new AuthUser(msg.user) : null;
    const hasDataFieldRules = authUser?.hasDataFieldRules(config?.access?.readRoles || '') ?? false;

    let paths;
    if (hasDataFieldRules) {
        // Data-field rules require adapter support for filtered listing
        if (!isDataFieldFilterable(adapter)) {
            return msg.setStatus(501, 'Data-field authorization requires adapter support for filtered listing');
        }
        const filters = authUser!.getDataFieldFilters(config!.access.readRoles);
        if (!filters) {
            return msg.setStatus(404, 'Not found');
        }
        paths = await adapter.listDatasetWithFilter(datasetName, filters, take, skip);
    } else {
        paths = await adapter.listDataset(datasetName, take, skip);
    }
    if (typeof paths === 'number') return msg.setStatus(paths);

    let dirState: DirState;
    const schemaExists = paths.some(([ f ]) => f === '.schema.json');
    if (isSchema(adapter) && !config.schema) {
        dirState = isWriteSchema(adapter) && !schemaExists
            ? DirState.mustCreateSchema
            : DirState.createInstanceAdapterSchema;
    } else {
        dirState = DirState.createInstanceConfigSchema
    }

    const spec = storeDescriptor(config.storePattern || "store", false, true, [], config.transformMimeTypes)

    switch (dirState) {
        case DirState.mustCreateSchema:
            spec.exceptionMimeTypes = { "/.schema.json": [ 'application/schema+json', 'application/schema+json' ] };
            spec.createFiles = false;
            break;
        case DirState.createInstanceConfigSchema:
            spec.exceptionMimeTypes = { "/.schema.json": [ 'application/schema+json', '' ] };
            spec.storeMimeTypes = [ await configSchemaInstanceContentType(datasetName, msg.url.baseUrl()) ];
            break;
        case DirState.createInstanceAdapterSchema:
            spec.storeMimeTypes = [ await (adapter as IDataAdapter & ISchemaAdapter).instanceContentType(datasetName, msg.url.baseUrl()) ];
            if (config.schema) {
                spec.exceptionMimeTypes = { "/.schema.json": [ 'application/schema+json', '' ] };
            }
            break;
    }

    const dirDesc = {
        path: msg.url.servicePath,
        paths,
        spec
    } as DirDescriptor;
    msg.data = MessageBody.fromObject(dirDesc).setIsDirectory();
    return msg;
});

const write = async (
    msg: Message,
    adapter: IDataAdapter | IDataAdapter & ISchemaAdapter,
    config: IDatasetConfig
) => {
    const datasetName = getDatasetName(config);
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Dataset write request should have a service path like <key>');
    }
    if (!msg.data) return msg.setStatus(400, "No data to write");

    let [ key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    if (isWriteSchema(adapter) && key.endsWith('.schema')) {
        if (config.schema) return msg.setStatus(400, "Can't write fixed schema");

        const schemaDetails = await adapter.checkSchema(datasetName);
        const res = await adapter.writeSchema(datasetName, await msg.data.asJson());
        msg.data.mimeType = 'application/json-schema';
        if (msg.method === "PUT") msg.data = undefined;
        return msg.setStatus(res === 200 && schemaDetails.status === 'none' ? 201 : res);
    } else {
        const details = await adapter.checkKey(datasetName, key);
        const isDirectory = (details.status === "directory" || (details.status === "none" && msg.url.isDirectory));
        if (isDirectory) {
            msg.data = undefined;
            return msg.setStatus(403, "Forbidden: can't overwrite directory");
        }

        // Data-field authorization for writes
        const authUser = msg.user ? new AuthUser(msg.user) : null;
        const writeRoles = config?.access?.writeRoles || '';
        const hasDataFieldRules = authUser?.hasDataFieldRules(writeRoles) ?? false;

        // For updates, check if user can modify the existing record
        if (hasDataFieldRules && details.status !== "none") {
            const existing = await adapter.readKey(datasetName, key);
            if (typeof existing !== 'number') {
                if (!authUser!.authorizedForDataRecord(existing, writeRoles, msg.url.servicePath)) {
                    // Return 404 to avoid leaking information about record existence
                    return msg.setStatus(404, 'Not found');
                }
            }
        }

        // Check new data matches authorization rules
        if (hasDataFieldRules) {
            const newData = await msg.data.asJson();
            if (!authUser!.authorizedForDataRecord(newData as Record<string, unknown>, writeRoles, msg.url.servicePath)) {
                // 403 is appropriate here - rejecting the data being written, not hiding existence
                return msg.setStatus(403, 'Forbidden: data-field mismatch in new data');
            }
        }

        // msg.data.copy() tees the stream
        const resCode = await adapter.writeKey(datasetName, key, msg.data.copy());
        if (msg.method === "PUT") msg.data = undefined;
        if (resCode !== 200) return msg.setStatus(resCode);
    
        return msg
            .setDateModified((details as ItemFile).dateModified)
            .setHeader('Location', msg.url.toString())
            .setStatus(details.status === "none" ? 201 : 200, msg.method === "PUT");
    }
}

service.post((msg, { adapter }, config) => write(msg, adapter, config));
service.put((msg, { adapter }, config) => write(msg, adapter, config));

service.delete(async (msg, { adapter }, config) => {
    const datasetName = getDatasetName(config);
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Dataset DELETE request should have a service path like <key>');
    }

    let [ key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    // Data-field authorization check for delete
    const authUser = msg.user ? new AuthUser(msg.user) : null;
    const writeRoles = config?.access?.writeRoles || '';
    const hasDataFieldRules = authUser?.hasDataFieldRules(writeRoles) ?? false;

    if (hasDataFieldRules) {
        const existing = await adapter.readKey(datasetName, key);
        if (typeof existing !== 'number') {
            if (!authUser!.authorizedForDataRecord(existing, writeRoles, msg.url.servicePath)) {
                // Return 404 to avoid leaking information about record existence
                return msg.setStatus(404, 'Not found');
            }
        }
    }

    const res = await adapter.deleteKey(datasetName, key);
    if (res === 404) {
        return msg.setStatus(404, 'Not found');
    } else if (res === 500) {
        return msg.setStatus(500, 'Internal server error');
    } else {
        return msg.setStatus(200);
    }
});

service.deleteDirectory((msg) => {
    return Promise.resolve(
        msg.setStatus(400, 'Cannot delete the underlying dataset of a dataset service')
    );
});

export default service;
