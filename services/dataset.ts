import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { DirDescriptor, StorePattern, storeDescriptor } from "rs-core/DirDescriptor.ts";
import { IReadOnlySchemaAdapter, ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { ItemFile } from "rs-core/ItemMetadata.ts";
import { IServiceConfig, ManualMimeTypes } from "rs-core/IServiceConfig.ts";

interface IDatasetConfig extends IServiceConfig {
    datasetName: string;
    schema?: Record<string, unknown>;
    uploadBaseUrl?: string;
    storePattern?: StorePattern;
    transformMimeTypes?: ManualMimeTypes;
}

const service = new Service<IDataAdapter, IDatasetConfig>();

/** Whether this is a schema adapter */
const isSchema = (adapter: IDataAdapter): adapter is IDataAdapter & IReadOnlySchemaAdapter =>
    (adapter as IDataAdapter & IReadOnlySchemaAdapter).checkSchema !== undefined;
const isWriteSchema = (adapter: IDataAdapter): adapter is IDataAdapter & ISchemaAdapter =>
    (adapter as IDataAdapter & ISchemaAdapter).writeSchema !== undefined;

const normaliseKey = (key: string) => {
    if (key.endsWith('.json')) return key.slice(0, -5);
    return key;
}

function configSchemaInstanceContentType(dataset: string, baseUrl: string): Promise<string> {
    const url = `${baseUrl}/.schema.json`;
    return Promise.resolve(`application/json; schema="${url}"`);
}

service.get(async (msg, { adapter }, config) => {
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Dataset GET request should have a service path like <key>');
    }

    let [ key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    let schema: Record<string, unknown> | undefined = undefined;

    if (isSchema(adapter) && !config.schema && key.endsWith('.schema')) {
        const schemaOut = await adapter.readSchema('');
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

    const details = await adapter.checkKey('', key);
    if (details.status === "none") {
        msg.data = undefined;
        return msg.setStatus(404, 'Not found');
    }

    if (msg.method !== 'HEAD') {
        const val = await adapter.readKey('', key);
        msg.data = MessageBody.fromObject(val);
        msg.data.dateModified = details.dateModified;
    }

    let getInstanceContentType = configSchemaInstanceContentType;
    if (isSchema(adapter) && !config.schema) {
        getInstanceContentType = adapter.instanceContentType;
    }
    msg.data!.mimeType = await getInstanceContentType('', msg.url.baseUrl());

    return msg;
});

service.getDirectory(async (msg, { adapter }, config: IDatasetConfig) => {
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
    const paths = await adapter.listDataset('', take, skip);
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
            spec.storeMimeTypes = [ await configSchemaInstanceContentType('', msg.url.baseUrl()) ];
            break;
        case DirState.createInstanceAdapterSchema:
            spec.storeMimeTypes = [ await (adapter as IDataAdapter & ISchemaAdapter).instanceContentType('', msg.url.baseUrl()) ];
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
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Dataset write request should have a service path like <key>');
    }
    if (!msg.data) return msg.setStatus(400, "No data to write");

    let [ key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    if (isWriteSchema(adapter) && key.endsWith('.schema')) {
        if (config.schema) return msg.setStatus(400, "Can't write fixed schema");

        const schemaDetails = await adapter.checkSchema('');
        const res = await adapter.writeSchema('', await msg.data.asJson());
        msg.data.mimeType = 'application/json-schema';
        if (msg.method === "PUT") msg.data = undefined;
        return msg.setStatus(res === 200 && schemaDetails.status === 'none' ? 201 : res);
    } else {
        const details = await adapter.checkKey('', key);
        const isDirectory = (details.status === "directory" || (details.status === "none" && msg.url.isDirectory));
        if (isDirectory) {
            msg.data = undefined;
            return msg.setStatus(403, "Forbidden: can't over.writeKey directory");
        } 
        // msg.data.copy() tees the stream
        const resCode = await adapter.writeKey('', key, msg.data.copy());
        msg.data = undefined;
        if (resCode !== 200) return msg.setStatus(resCode);
    
        return msg
            .setDateModified((details as ItemFile).dateModified)
            .setHeader('Location', msg.url.toString())
            .setStatus(details.status === "none" ? 201 : 200, details.status === "none" ? "Created" : "OK");
    }
}

service.post((msg, { adapter }, config) => write(msg, adapter, config));
service.put((msg, { adapter }, config) => write(msg, adapter, config));

service.delete(async (msg, { adapter }) => {
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Dataset DELETE request should have a service path like <key>');
    }

    let [ key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    const res = await adapter.deleteKey('', key);
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