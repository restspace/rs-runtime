import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { ItemFile } from "rs-core/ItemMetadata.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { DirDescriptor, StoreSpec } from "rs-core/DirDescriptor.ts";
import { IServiceConfig } from "../../rs-core/IServiceConfig.ts";
import { getType } from "../../rs-core/mimeType.ts";
import { ServiceContext } from "../../rs-core/ServiceContext.ts";

interface IFileServiceConfig extends IServiceConfig {
    extensions?: string[];
}

const service = new Service<IFileAdapter>();

service.get(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    const details = await adapter.check(msg.url.servicePath, config.extensions);
    if (details.status === "none") {
        msg.data = undefined;
        return msg.setStatus(404, 'Not found');
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
        msg.data = await adapter.read(msg.url.servicePath, config.extensions, start, end);
    }
    msg.data!.size = start !== undefined && end !== undefined ? end - start + 1 : fileDetails.size;
    msg.data!.dateModified = details.dateModified;

    return msg;
});

service.getDirectory(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    // TODO manage as a stream as adapter can list directory files as a stream
    const readDirPath = async (path: string) => {
        const dirData = await adapter.readDirectory(path);
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

service.post(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    if (!msg.hasData()) return msg.setStatus(400, "No data to write");

    const details = await adapter.check(msg.url.servicePath, config.extensions);
    if (details.status === "directory" || (details.status === "none" && msg.url.isDirectory)) {
        // if (isZip(msg.getHeader('Content-Type'))) {
        //     // save directory as zip
        //     let failCount = 0;
        //     let failStatus: number;
        //     for await (let resMsg of unzip(msg).flatMap(msg => this.processPut(msg))) {
        //         if (!resMsg.ok) {
        //             failCount++;
        //             if (failStatus === undefined) failStatus = resMsg.status;
        //             else if (failStatus !== resMsg.status) failStatus = -1;
        //         }
        //     }
        //     if (failCount) return msg.setStatus(failStatus || 400);
        // } else {
            return msg.setStatus(403, "Forbidden: can't overwrite directory");
        //}
    } else {
        const resCode = await adapter.write(msg.url.servicePath, msg.data!.copy(), config.extensions);
        if (resCode !== 200) return msg.setStatus(resCode);
    }
    return msg
        .setHeader('Location', msg.url.toString())
        .setStatus(details.status === "none" ? 201 : 200);
});

service.put(async (msg: Message, { adapter }: ServiceContext<IFileAdapter>, config: IFileServiceConfig) => {
    if (!msg.hasData()) return msg.setStatus(400, "No data to write");

    const details = await adapter.check(msg.url.servicePath, config.extensions);
    if (details.status === "directory" || (details.status === "none" && msg.url.isDirectory)) {
        return msg.setStatus(403, "Forbidden: can't overwrite directory");
    } else {
        const resCode = await adapter.write(msg.url.servicePath, msg.data!, config.extensions);
        msg.data = undefined;
        if (resCode !== 200) return msg.setStatus(resCode);
    }
    return msg
        .setHeader('Location', msg.url.toString())
        .setStatus(details.status === "none" ? 201 : 200);
});

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