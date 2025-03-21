import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { DirDescriptor, StoreSpec } from "rs-core/DirDescriptor.ts";
import { IReadOnlySchemaAdapter, ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { ItemFile } from "rs-core/ItemMetadata.ts";
import { ServiceContext, WrappedLogger } from "rs-core/ServiceContext.ts";
import { deleteProp, patch, setProp } from "rs-core/utility/utility.ts";
import * as log from "std/log/mod.ts";

const service = new Service<IDataAdapter>();

/** Capabilities of the adapter. This determines whether schemas are required for data. */
const isSchema = (adapter: IDataAdapter): adapter is IDataAdapter & IReadOnlySchemaAdapter =>
    (adapter as IDataAdapter & IReadOnlySchemaAdapter).checkSchema !== undefined;
const isWriteSchema = (adapter: IDataAdapter): adapter is IDataAdapter & ISchemaAdapter =>
    (adapter as IDataAdapter & ISchemaAdapter).writeSchema !== undefined;

const normaliseKey = (key: string) => {
    if (key?.endsWith('.json')) return key.slice(0, -5);
    return key;
}

service.get(async (msg: Message, { adapter }: ServiceContext<IDataAdapter>) => {
    if (msg.url.servicePathElements.length !== 2) {
        return msg.setStatus(400, 'Data GET request should have a service path like <dataset>/<key>');
    }

    let [ dataset, key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    // fetching a schema
    if (isSchema(adapter) && key.endsWith('.schema')) {
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
    const take = msg.url.query['$take'] ? parseInt(msg.url.query['$take'][0]) : undefined;
    const skip = msg.url.query['$skip'] ? parseInt(msg.url.query['$skip'][0]) : undefined;
    const paths =  await adapter.listDataset(dataset, take, skip);
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

const write = async (msg: Message, adapter: IDataAdapter, logger: WrappedLogger, isPatch: boolean, isKeyless = false) => {
    const servicePathLength = msg.url.servicePathElements.length;
    if (servicePathLength !== 1 && isKeyless) {
        return msg.setStatus(400, 'Keyless data write request should have a service path like <dataset>');
    }
    if (servicePathLength !== 2 && !isKeyless) {
        return msg.setStatus(400, 'Data write request should have a service path like <dataset>/<key>');
    }
    if (!msg.hasData()) return msg.setStatus(400, "No data to write");

    let dataset: string;
    let key: string | undefined;
    [ dataset, key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    if (isWriteSchema(adapter) && key?.endsWith('.schema')) {
        const schemaDetails = await adapter.checkSchema(dataset);
        const res = await adapter.writeSchema!(dataset, await msg.data!.asJson());
        msg.data!.mimeType = 'application/json-schema';
        if (msg.method === "PUT") msg.data = undefined;
        return msg.setStatus(res === 200 && schemaDetails.status === 'none' ? 201 : res);
    } else {
        const details = key === '' ? { status: 'none' } : await adapter.checkKey(dataset, key);
        const isDirectory = (details.status === "directory" || (details.status === "none" && msg.url.isDirectory));
        if (key && isDirectory) {
            msg.data = undefined;
            return msg.setStatus(403, "Forbidden: can't overwrite directory");
        } 

        let resCode: number | string = 0;

        if (isPatch || msg.url.fragment) {
            // TO DO this operation should be atomic somehow - maybe readKeySync or adapter.writeLockKey
            let val = await adapter.readKey(dataset, key);
            if (typeof val === 'number') {
                const details = await adapter.checkKey(dataset, key);
                if (details.status === "none") {
                    val = {};
                } else {
                    return msg.setStatus(val, 'Was reading full value to ' + (isPatch ? 'update with patch' : 'write back fragment'));
                }
            }
            const d = await msg.data?.asJson();
            //logger.info(`patch data ${JSON.stringify(d)}`);
            if (isPatch) {
                val = patch(val, d);
                //logger.info(`patch result ${JSON.stringify(val)}`);
            } else {
                setProp(val, msg.url.fragment, d);
            }
            resCode = await adapter.writeKey(dataset, key, MessageBody.fromObject(val));
        } else {
            // msg.data.copy() tees the stream
            resCode = await adapter.writeKey(dataset, key, msg.data!.copy());
        }
        if (msg.method === "PUT") msg.data = undefined;
        if (typeof resCode === 'number' && resCode >= 300) return msg.setStatus(resCode);

        let location = msg.url.toString();
        if (isKeyless) location += resCode;
    
        return msg
            .setDateModified((details as ItemFile).dateModified)
            .setHeader('Location', location)
            .setStatus(details.status === "none" ? 201 : 200, msg.method === "PUT");
    }
}

service.post((msg, { adapter, logger }) => write(msg, adapter, logger, false));
service.put((msg, { adapter, logger }) => write(msg, adapter, logger, false));
service.patch((msg, { adapter, logger }) => write(msg, adapter, logger, true));
service.putDirectory((msg, { adapter, logger }) => write(msg, adapter, logger, false, true));
service.postDirectory((msg, { adapter, logger }) => write(msg, adapter, logger, false, true));

service.delete(async (msg, { adapter }) => {
    if (msg.url.servicePathElements.length !== 2) {
        return msg.setStatus(400, 'Data DELETE request should have a service path like <dataset>/<key> or <dataset>/');
    }

    let [ dataset, key ] = msg.url.servicePathElements;
    key = normaliseKey(key);

    let res: number | string = 0;
    if (msg.url.fragment) {
        const val = await adapter.readKey(dataset, key);
        if (typeof val === 'number') {
            return msg.setStatus(val, 'Was reading full value to write back fragment');
        }
        try {
            deleteProp(val, msg.url.fragment);
        } catch {
            return msg.setStatus(400, 'Cannot delete this fragment path');
        }
        res = await adapter.writeKey(dataset, key, MessageBody.fromObject(val));
    } else {
        res = await adapter.deleteKey(dataset, key);
    }

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
        return msg.setStatus(400, 'Data DELETE request should have a service path like <dataset>/<key> or <dataset>/');
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