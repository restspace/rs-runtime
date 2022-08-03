import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { DirDescriptor, StoreSpec } from "rs-core/DirDescriptor.ts";
import { IReadOnlySchemaAdapter, ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { ItemFile } from "rs-core/ItemMetadata.ts";
import { ServiceContext } from "../../rs-core/ServiceContext.ts";

const service = new Service<IDataAdapter>();

/** Capabilities of the adapter. This determines whether schemas are required for data. */
const isSchema = (adapter: IDataAdapter): adapter is IDataAdapter & IReadOnlySchemaAdapter =>
    (adapter as IDataAdapter & IReadOnlySchemaAdapter).checkSchema !== undefined;
const isWriteSchema = (adapter: IDataAdapter): adapter is IDataAdapter & ISchemaAdapter =>
    (adapter as IDataAdapter & ISchemaAdapter).writeSchema !== undefined;

service.get(async (msg: Message, { adapter }: ServiceContext<IDataAdapter>) => {
    if (msg.url.servicePathElements.length !== 2) {
        return msg.setStatus(400, 'Data GET request should have a service path like <dataset>/<key>');
    }

    const [ dataset, key ] = msg.url.servicePathElements;

    // fetching a schema
    if (isSchema(adapter) && key.endsWith('.schema.json')) {
        const schema = await adapter.readSchema(dataset);
        if (typeof schema === 'number') {
            return msg.setStatus(schema);
        } else {
            const outMsg = msg.setDataJson(schema);
            outMsg.data!.mimeType = 'application/schema+json';
            return outMsg;
        }
    }

    const details = await adapter.checkKey(dataset, key);
    if (details.status === "none") {
        msg.data = undefined;
        return msg.setStatus(404, 'Not found');
    }

    if (msg.method !== 'HEAD') {
        const val = await adapter.readKey(dataset, key);
        msg.data = MessageBody.fromObject(val);
        msg.data.dateModified = details.dateModified;
    }

    // if we are using a schema, set a pointer in the mime type
    if (isSchema(adapter) && msg.data) {
        msg.data.mimeType = await adapter.instanceContentType(dataset, msg.url.baseUrl());
    }

    return msg;
});

service.getDirectory(async (msg: Message, { adapter }: ServiceContext<IDataAdapter>) => {
    if (msg.url.servicePathElements.length > 1) {
        return msg.setStatus(400, 'Data GET directory request should be like <dataset>/ or just /');
    }
    const pathEls = msg.url.servicePathElements;
    const dataset = pathEls.length ? pathEls[0] : '';
    const paths =  await adapter.listDataset(dataset);
    if (typeof paths === 'number') return msg.setStatus(paths);

    enum DirState {
        topLevelNoCreate,
        topLevelCreateDirs,
        mustCreateSchema,
        createJson,
        createInstance
    }

    let dirState: DirState;
    if (dataset === '') {
        dirState = isWriteSchema(adapter) ? DirState.topLevelCreateDirs : DirState.topLevelNoCreate;
    } else {
        if (isSchema(adapter)) {
            dirState = paths.some(( [ filename ] ) => filename === '.schema.json') ? DirState.createInstance : DirState.mustCreateSchema;
        } else {
            dirState = DirState.createJson;
        }
    }

    const spec: StoreSpec = {
        pattern: "store",
        storeMimeTypes: [],
        createDirectory: false,
        createFiles: true
    };

    switch (dirState) {
        case DirState.createInstance: {
            const instanceMimeType = await (adapter as IDataAdapter & IReadOnlySchemaAdapter).instanceContentType(dataset, msg.url.baseUrl());
            spec.storeMimeTypes = [ instanceMimeType ];
            spec.exceptionMimeTypes = { ".schema.json": [ 'application/schema+json', 'application/schema+json' ] };
            break;
        }
        case DirState.createJson:
            spec.storeMimeTypes = [ 'application/json' ];
            break;
        case DirState.mustCreateSchema:
            spec.exceptionMimeTypes = { ".schema.json": [ 'application/schema+json', 'application/schema+json' ] };
            spec.createFiles = false;
            break;
        case DirState.topLevelNoCreate:
            break;
        case DirState.topLevelCreateDirs:
            spec.createDirectory = true;
            spec.createFiles = false;
            break;
    }
    const dirDesc = {
        path: msg.url.servicePath,
        paths,
        spec
    } as DirDescriptor;
    return msg.setDirectoryJson(dirDesc);
});

const write = async (msg: Message, adapter: IDataAdapter) => {
    if (msg.url.servicePathElements.length !== 2) {
        return msg.setStatus(400, 'Data write request should have a service path like <dataset>/<key>');
    }
    if (!msg.hasData()) return msg.setStatus(400, "No data to write");

    const [ dataset, key ] = msg.url.servicePathElements;

    if (isWriteSchema(adapter) && key.endsWith('.schema.json')) {
        const schemaDetails = await adapter.checkSchema(dataset);
        const res = await adapter.writeSchema!(dataset, await msg.data!.asJson());
        msg.data!.mimeType = 'application/json-schema';
        if (msg.method === "PUT") msg.data = undefined;
        return msg.setStatus(res === 200 && schemaDetails.status === 'none' ? 201 : res);
    } else {
        const details = await adapter.checkKey(dataset, key);
        const isDirectory = (details.status === "directory" || (details.status === "none" && msg.url.isDirectory));
        if (isDirectory) {
            msg.data = undefined;
            return msg.setStatus(403, "Forbidden: can't over.writeKey directory");
        } 
        // msg.data.copy() tees the stream
        const resCode = await adapter.writeKey(dataset, key, msg.data!.copy());
        msg.data = undefined;
        if (resCode !== 200) return msg.setStatus(resCode);
    
        return msg
            .setDateModified((details as ItemFile).dateModified)
            .setHeader('Location', msg.url.toString())
            .setStatus(details.status === "none" ? 201 : 200, details.status === "none" ? "Created" : "OK");
    }
}

service.post((msg, { adapter }) => write(msg, adapter));
service.put((msg, { adapter }) => write(msg, adapter));

service.delete(async (msg, { adapter }) => {
    if (msg.url.servicePathElements.length !== 2) {
        return msg.setStatus(400, 'Data DELETE request should have a service path like <dataset>/<key> or <dataset>');
    }

    const [ dataset, key ] = msg.url.servicePathElements;

    const res = await adapter.deleteKey(dataset, key);
    if (res === 404) {
        return msg.setStatus(404, 'Not found');
    } else if (res === 500) {
        return msg.setStatus(500, 'Internal server error');
    } else {
        return msg.setStatus(200);
    }
});

service.deleteDirectory(async (msg, { adapter }) => {
    if (msg.url.servicePathElements.length !== 1) {
        return msg.setStatus(400, 'Data DELETE request should have a service path like <dataset>/<key> or <dataset>');
    }
    const [ dataset ] = msg.url.servicePathElements;

    try {
        const status = await adapter.deleteDataset(dataset);
        if (status === 400) {
            return msg.setStatus(400, 'Not empty');
        } else if (status === 404) {
            return msg.setStatus(404, 'Not found');
        } else if (status === 500) {
            return msg.setStatus(500, 'Internal server error');
        }
    } catch {
        return msg.setStatus(500, 'Internal server error');
    }
    
    return msg;
});

export default service;