import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { ItemMetadata } from "rs-core/ItemMetadata.ts";
import { slashTrim } from "rs-core/utility/utility.ts";
import * as path from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts"
import { readFileStream, toBlockChunks, writeFileStream } from "rs-core/streams/streams.ts";
import { readableStreamFromIterable } from "std/io/streams.ts";
import { getType } from "rs-core/mimeType.ts";
import { fileToDataAdapter } from "./fileToDataAdapter.ts";
import { dataToSchemaAdapter } from "./dataToSchemaAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";

export interface LocalFileAdapterProps {
    rootPath: string;
    basePath: string;
}

class LocalFileAdapterBase implements IFileAdapter {
    rootPath: string;
    basePath: string;

    constructor(public context: AdapterContext, public props: LocalFileAdapterProps) {
        this.rootPath = props.rootPath.replace('${tenant}', context.tenant);
        this.basePath = props.basePath;
    }

    canonicalisePath(path: string): string {
        return path.replace(/[\\:*"<>|]/g, '-'); // eliminate any illegal characters for a filename
    }

    decanonicalisePath(path: string): string { return path; }

    /** returns the file path & extension: config.dataPathBase()/this.filePathRoot/reqPath */
    getPathParts(reqPath: string, extensions?: string[], forDir?: boolean, ensureDirExists?: boolean): [string, string] {
        reqPath = reqPath.split('?')[0]; // remove any query string
        if (reqPath.endsWith('/')) forDir = true;
        let fullPath = this.basePath + '/' + decodeURI(slashTrim(reqPath));
        fullPath = fullPath.replace(/^\//, '')
            .replace('//', '/');
        fullPath = this.canonicalisePath(fullPath);
        const pathParts = fullPath.split('/');
        if (ensureDirExists) ensureDir(path.join(this.rootPath, ...pathParts.slice(0, -1)));

        let ext = '';
        if (!forDir) {
            const dotParts = pathParts[pathParts.length - 1].split('.');
            const pathExt = dotParts[dotParts.length - 1];
            extensions = extensions || [];
            if (extensions.length && (dotParts.length === 1 || !extensions.includes(pathExt))) {
                ext = extensions[0];
            } else if (dotParts.length > 1) {
                ext = dotParts.pop() as string;
                pathParts[pathParts.length - 1] = dotParts.join('.');
            }
        }
        
        const filePath = path.join(this.rootPath, ...pathParts);
        return [ filePath, ext ];
    }

    getPath(reqPath: string, extensions?: string[], forDir?: boolean, ensureDir?: boolean): string {
        const [ filePath, ext ] = this.getPathParts(reqPath, extensions, forDir, ensureDir);
        return filePath + (ext ? '.' + ext : '');
    }

    async read(readPath: string, extensions?: string[], startByte?: number, endByte?: number): Promise<MessageBody> {
        const filePath = this.getPath(readPath, extensions);
        let stream: ReadableStream;
        try {
            stream = await readFileStream(filePath, startByte, endByte);
            return new MessageBody(stream, getType(filePath) || 'text/plain');
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) return MessageBody.fromError(404);
            throw new Error(`LocalFileAdapter reading file: ${readPath}, ${err}`);
        }
    }

    async write(path: string, data: MessageBody, extensions?: string[]) {
        // TODO Add a write queue to avoid interleaved writes from different requests
        let writeStream: WritableStream | null = null;
        try {
            writeStream = await writeFileStream(this.getPath(path, extensions, false, true));
            const readableStream = data.asReadable();
            if (readableStream === null) throw new Error('no data');
            await readableStream.pipeTo(writeStream);
            return 200;
        } catch (err) {
            return (err instanceof Deno.errors.NotFound) ? 404 : 500;
        } //finally {
        //     if (writeStream) {
        //         const writer = writeStream.getWriter();
        //         if (!writer.closed) await writer.close();
        //     }
        // }
    }

    async delete(path: string, extensions?: string[]) {
        try {
            await Deno.remove(this.getPath(path, extensions));
        } catch (err) {
            return (err instanceof Deno.errors.NotFound ? 404 : 500);
        }
        return 200;
    }

    /** streams a JSON list of sublists [ filename ], to minimise JSON characters needed */
    private dirIter = async function* (dirPath: string, getUpdateTime: boolean) {
        yield '[';
        let first = true;
        for await (const entry of Deno.readDir(dirPath)) {
            let updateStr = "";
            if (getUpdateTime) {
                const stat = await Deno.stat(path.join(dirPath, entry.name));
                updateStr = stat.mtime ? "," + stat.mtime.getTime().toString() : "";
            }
            const listName = entry.name + (entry.isDirectory ? "/" : "");
            yield `${first ? '': ','} [ "${listName}"${updateStr} ]`;
            first = false;
        }
        yield ']';
    };

    async readDirectory(readPath: string, getUpdateTime = false) {
        const filePath = this.getPath(readPath, undefined, true);
        let stat: Deno.FileInfo;
        try {
            stat = await Deno.stat(filePath);
        } catch(err) {
            return (err instanceof Deno.errors.NotFound) ? MessageBody.fromError(404) : MessageBody.fromError(500);
        }
        if (!stat.isDirectory) return MessageBody.fromError(400);

        const blockIter = toBlockChunks(this.dirIter(filePath, getUpdateTime || false));

        return new MessageBody(readableStreamFromIterable(blockIter), 'text/plain').setIsDirectory();
    }

    async deleteDirectory(path: string, deleteableFileSuffix = ''): Promise<number> {
        const filePath = this.getPath(path, undefined, true);
        let stat: Deno.FileInfo;
        try {
            stat = await Deno.stat(filePath);
        } catch(err) {
            return (err instanceof Deno.errors.NotFound) ? 200 : 500; // delete non-existent dir is ok
        }
        if (!stat.isDirectory) return 400;

        
        for await (const entry of Deno.readDir(filePath)) {
            if (entry.isDirectory || !(deleteableFileSuffix && entry.name.endsWith(deleteableFileSuffix))) {
                return 400;
            }
        }
        await Deno.remove(filePath, { recursive: true });
        return 200;
    }

    async check(path: string, extensions?: string[]): Promise<ItemMetadata> {
        const filePath = this.getPath(path, extensions);
        let stat: Deno.FileInfo;
        try {
            stat = await Deno.stat(filePath);
        } catch {
            return { status: 'none' };
        }
        
        const status = stat.isDirectory ? "directory" : "file";
        switch (status) {
            case "directory":
                return { status, dateModified: stat.mtime as Date };
            default:
                return { status, size: stat.size, dateModified: stat.mtime as Date }
        }

    }

    async move(fromPath: string, toPath: string, extensions?: string[]) {
        const fromFullPath = this.getPath(fromPath);
        const toFullPath = this.getPath(toPath, extensions, false, true);
        try {
            await Deno.rename(fromFullPath, toFullPath);
        } catch (err) {
            return (err instanceof Deno.errors.NotFound) ? 404: 500;
        }
        return 200;
    }
}

export default dataToSchemaAdapter(fileToDataAdapter(LocalFileAdapterBase));