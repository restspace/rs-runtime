import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { ItemFile } from "rs-core/ItemMetadata.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { DirDescriptor, StoreSpec } from "rs-core/DirDescriptor.ts";
import { IServiceConfig } from "../../rs-core/IServiceConfig.ts";
import { getType, isZip } from "../../rs-core/mimeType.ts";
import { ServiceContext } from "../../rs-core/ServiceContext.ts";
import { unzip } from "../pipeline/unzipSplitter.ts";
import { Url } from "../../rs-core/Url.ts";

interface IFileServiceConfig extends IServiceConfig {
    extensions?: string[];
    parentIfMissing?: boolean;
}

const findParent = async (url: Url,
        context: ServiceContext<IFileAdapter>,
        config: IFileServiceConfig): Promise<[ Url | null, ItemFile | null ]> => {
    const testUrl = url.copy();
    const servicePathLen = url.servicePathElements.length;
    if (servicePathLen <= 1) return [ null, null ];
    testUrl.servicePath = '';
    let idx = 0;
    testUrl.pathElements.push(url.servicePathElements[idx]);
    while ((await context.adapter.check(testUrl.servicePath, config.extensions)).status === "directory"
            && idx < servicePathLen) {
        idx++;
        testUrl.pathElements.push(url.servicePathElements[idx]);
    }
    if (idx === servicePathLen) return [ null, null ];
    const details = await context.adapter.check(testUrl.servicePath, config.extensions);
    return details.status === "file" ? [ testUrl, details as ItemFile ] : [ null, null ];
}

const service = new Service<IFileAdapter>();

service.get(async (msg: Message, context: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    let details = await context.adapter.check(msg.url.servicePath, config.extensions);
    if (details.status === "none") {
        if (config.parentIfMissing) {
            const [ parentUrl, parentDetails ] = await findParent(msg.url, context, config);
            if (parentUrl !== null && parentDetails !== null) {
                msg.setUrl(parentUrl);
                details = parentDetails;
            }
        }
        if (details.status === "none") {
            msg.data = undefined;
            return msg.setStatus(404, 'Not found');
        }
    }
    const fileDetails = details as ItemFile;

    // range handling
    let start: number | undefined, end: number | undefined;
    msg.setHeader('Accept-Ranges', 'bytes');
    msg.data = new MessageBody(null, "text/plain");
    const range = msg.getRequestRange(fileDetails.size);
    if (range === -1) { // unsatisfiable
        return msg.setRange('bytes', fileDetails.size).setStatus(416, 'Requested Range not Satisfiable');
    }
    if (range && range !== -2 && range.length === 1) {
        msg.setStatus(206).setRange('bytes', fileDetails.size, range[0]);
        start = range[0].start;
        end = Math.min(range[0].end, fileDetails.size - 1);
    }

    if (msg.method !== 'HEAD') {
        msg.data = await context.adapter.read(msg.url.servicePath, config.extensions, start, end);
    }
    msg.data!.size = start !== undefined && end !== undefined ? end - start + 1 : fileDetails.size;
    msg.data!.dateModified = details.dateModified;

    return msg;
});

service.getDirectory(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    // TODO manage as a stream as adapter can list directory files as a stream
    const readDirPath = async (path: string) => {
        const dirData = await adapter.readDirectory(path);

        // convention is a non-existent directory is not a 404 but an empty list, because in some systems,
        // a directory exists only by virtue of files existing on the path of the directory
        const paths = dirData?.ok ? ((await dirData.asJson()) || []) : [];
        return {
            path: msg.url.servicePath,
            paths,
            spec: {
                pattern: "store",
                storeMimeTypes: (config.extensions || []).map(ext => getType(ext)),
                createDirectory: true,
                createFiles: true
            } as StoreSpec
        } as DirDescriptor;
    }
    const featureResult = await readDirPath(msg.url.servicePath);
    return msg.setDirectoryJson(featureResult);
});

const writeAction = (returnData: boolean) => async (msg: Message, context: ServiceContext<IFileAdapter>, config: IFileServiceConfig): Promise<Message> => {
    const { adapter } = context;
    if (!msg.hasData()) return msg.setStatus(400, "No data to write");

    const details = await adapter.check(msg.url.servicePath, config.extensions);
    if (details.status === "directory" || (details.status === "none" && msg.url.isDirectory)) {
        if (isZip(msg.getHeader('Content-Type'))) {
            // save directory as zip
            let failCount = 0;
            let failStatus: number | undefined = undefined;
            try {
                for await (const resMsg of unzip(msg).flatMap(msg => writeAction(returnData)(msg, context, config))) {
                    if (!resMsg.ok) {
                        failCount++;
                        if (failStatus === undefined) failStatus = resMsg.status;
                        else if (failStatus !== resMsg.status) failStatus = -1;
                    }
                }
            } catch (err) {
                return msg.setStatus(500, `Error unzipping: ${err}`);
            }
            if (failCount) return msg.setStatus(failStatus || 400);
        } else {
            return msg.setStatus(403, "Forbidden: can't overwrite directory");
        }
    } else {
        const resCode = await adapter.write(msg.url.servicePath, msg.data!.copy(), config.extensions);
        if (!returnData) msg.data = undefined;
        if (resCode !== 200) return msg.setStatus(resCode);
    }
    return msg
        .setHeader('Location', msg.url.toString())
        .setStatus(details.status === "none" ? 201 : 200);
};

service.post(writeAction(true));
service.put(writeAction(false));

service.delete(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    const res = await adapter.delete(msg.url.servicePath, config.extensions);
    msg.data = undefined;
    if (res === 404) {
        return msg.setStatus(404, 'Not found');
    } else if (res === 500) {
        return msg.setStatus(500, 'Internal server error');
    } else {
        return msg.setStatus(200);
    }
});

service.deleteDirectory(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>) => {
    try {
        const status = await adapter.deleteDirectory(msg.url.servicePath, '.config.json');
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