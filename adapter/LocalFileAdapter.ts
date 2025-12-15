import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { ItemMetadata } from "rs-core/ItemMetadata.ts";
import { slashTrim } from "rs-core/utility/utility.ts";
import * as path from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts"
import { readFileStream, toBlockChunks, writeFileStream } from "rs-core/streams/streams.ts";
import { readableStreamFromIterable } from "std/streams/readable_stream_from_iterable.ts";
import { getType } from "rs-core/mimeType.ts";
import { fileToDataAdapter } from "./fileToDataAdapter.ts";
import { dataToSchemaAdapter } from "./dataToSchemaAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface LocalFileAdapterProps {
    rootPath: string;
    basePath: string;
    /**
     * Default maximum time (ms) to wait in the lock queue before failing with 423 Locked.
     * If not set or 0, waits indefinitely.
     */
    lockTimeoutMs?: number;
    /** Optional override for read operations. */
    readLockTimeoutMs?: number;
    /** Optional override for write/delete/move operations. */
    writeLockTimeoutMs?: number;
}

// Simple in-process per-path lock manager to serialise file access
type LockType = "read" | "write";
type ReleaseLock = () => void;

class LockTimeoutError extends Error {
    constructor(public filePath: string, public lockType: LockType) {
        super(`Lock timeout for ${lockType} lock on ${filePath}`);
        this.name = 'LockTimeoutError';
    }
}

interface LockRequest {
    type: LockType;
    resolve: (release: ReleaseLock) => void;
    reject: (err: Error) => void;
    timerId?: number;
}

interface LockState {
    readers: number;
    writer: boolean;
    queue: LockRequest[];
}

const fileLocks = new Map<string, LockState>();

const getLockState = (filePath: string): LockState => {
    let state = fileLocks.get(filePath);
    if (!state) {
        state = { readers: 0, writer: false, queue: [] };
        fileLocks.set(filePath, state);
    }
    return state;
};

const clearRequestTimer = (req: LockRequest) => {
    if (req.timerId !== undefined) {
        clearTimeout(req.timerId);
        req.timerId = undefined;
    }
};

const serviceQueue = (filePath: string, state: LockState) => {
    while (state.queue.length > 0) {
        const next = state.queue[0];
        if (next.type === "read") {
            if (state.writer) break;
            state.queue.shift();
            clearRequestTimer(next);
            state.readers++;
            const release = makeRelease(filePath, state, "read");
            next.resolve(release);
            continue;
        } else {
            if (state.writer || state.readers > 0) break;
            state.queue.shift();
            clearRequestTimer(next);
            state.writer = true;
            const release = makeRelease(filePath, state, "write");
            next.resolve(release);
            break;
        }
    }
};

const makeRelease = (filePath: string, state: LockState, type: LockType): ReleaseLock => {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (type === "read") {
            state.readers--;
        } else {
            state.writer = false;
        }
        if (state.readers < 0) state.readers = 0;
        if (!state.writer && state.readers === 0 && state.queue.length === 0) {
            fileLocks.delete(filePath);
        } else {
            serviceQueue(filePath, state);
        }
    };
};

const acquireReadLock = (filePath: string, timeoutMs?: number): Promise<ReleaseLock> => {
    const state = getLockState(filePath);
    if (!state.writer && state.queue.length === 0) {
        state.readers++;
        return Promise.resolve(makeRelease(filePath, state, "read"));
    }
    return new Promise<ReleaseLock>((resolve, reject) => {
        const request: LockRequest = { type: "read", resolve, reject };
        if (timeoutMs && timeoutMs > 0) {
            request.timerId = setTimeout(() => {
                const idx = state.queue.indexOf(request);
                if (idx >= 0) {
                    state.queue.splice(idx, 1);
                }
                reject(new LockTimeoutError(filePath, "read"));
                serviceQueue(filePath, state);
            }, timeoutMs);
        }
        state.queue.push(request);
        serviceQueue(filePath, state);
    });
};

const acquireWriteLock = (filePath: string, timeoutMs?: number): Promise<ReleaseLock> => {
    const state = getLockState(filePath);
    if (!state.writer && state.readers === 0 && state.queue.length === 0) {
        state.writer = true;
        return Promise.resolve(makeRelease(filePath, state, "write"));
    }
    return new Promise<ReleaseLock>((resolve, reject) => {
        const request: LockRequest = { type: "write", resolve, reject };
        if (timeoutMs && timeoutMs > 0) {
            request.timerId = setTimeout(() => {
                const idx = state.queue.indexOf(request);
                if (idx >= 0) {
                    state.queue.splice(idx, 1);
                }
                reject(new LockTimeoutError(filePath, "write"));
                serviceQueue(filePath, state);
            }, timeoutMs);
        }
        state.queue.push(request);
        serviceQueue(filePath, state);
    });
};

class LocalFileAdapterBase implements IFileAdapter {
    rootPath: string;
    basePath: string;
    readLockTimeoutMs?: number;
    writeLockTimeoutMs?: number;

    constructor(public context: AdapterContext, public props: LocalFileAdapterProps) {
        this.rootPath = props.rootPath.replace('${tenant}', context.tenant);
        this.basePath = props.basePath;
        this.readLockTimeoutMs = props.readLockTimeoutMs ?? props.lockTimeoutMs;
        this.writeLockTimeoutMs = props.writeLockTimeoutMs ?? props.lockTimeoutMs;
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
        let releaseLock: ReleaseLock | null = null;
        let baseStream: ReadableStream;

        try {
            releaseLock = await acquireReadLock(filePath, this.readLockTimeoutMs);
        } catch (err) {
            if (err instanceof LockTimeoutError) {
                return MessageBody.fromError(423, 'Locked');
            }
            throw err;
        }

        try {
            baseStream = await readFileStream(filePath, startByte, endByte);
        } catch (err) {
            if (releaseLock) {
                releaseLock();
                releaseLock = null;
            }
            if (err instanceof Deno.errors.NotFound) return MessageBody.fromError(404);
            throw new Error(`LocalFileAdapter reading file: ${readPath}, ${err}`);
        }

        const reader = baseStream.getReader();
        const wrappedStream = new ReadableStream({
            async pull(controller) {
                try {
                    const { value, done } = await reader.read();
                    if (done) {
                        if (releaseLock) {
                            releaseLock();
                            releaseLock = null;
                        }
                        controller.close();
                    } else if (value !== undefined) {
                        controller.enqueue(value);
                    }
                } catch (err) {
                    if (releaseLock) {
                        releaseLock();
                        releaseLock = null;
                    }
                    controller.error(err);
                }
            },
            async cancel(reason) {
                try {
                    await reader.cancel(reason);
                } finally {
                    if (releaseLock) {
                        releaseLock();
                        releaseLock = null;
                    }
                }
            }
        });

        return new MessageBody(wrappedStream, getType(filePath) || 'text/plain');
    }

    async write(path: string, data: MessageBody, extensions?: string[]) {
        const filePath = this.getPath(path, extensions, false, true);
        let writeStream: WritableStream | null = null;
        let releaseLock: ReleaseLock | null = null;
        try {
            try {
                releaseLock = await acquireWriteLock(filePath, this.writeLockTimeoutMs);
            } catch (err) {
                if (err instanceof LockTimeoutError) {
                    return 423;
                }
                throw err;
            }
            writeStream = await writeFileStream(filePath);
            const readableStream = data.asReadable();
            if (readableStream === null) throw new Error('no data');
            await readableStream.pipeTo(writeStream);
            return 200;
        } catch (err) {
            return (err instanceof Deno.errors.NotFound) ? 404 : 500;
        } finally {
            if (releaseLock) {
                releaseLock();
            }
        }
    }

    async delete(path: string, extensions?: string[]) {
        const filePath = this.getPath(path, extensions);
        let releaseLock: ReleaseLock | null = null;
        try {
            try {
                releaseLock = await acquireWriteLock(filePath, this.writeLockTimeoutMs);
            } catch (err) {
                if (err instanceof LockTimeoutError) {
                    return 423;
                }
                throw err;
            }
            await Deno.remove(filePath);
        } catch (err) {
            return (err instanceof Deno.errors.NotFound ? 404 : 500);
        } finally {
            if (releaseLock) {
                releaseLock();
            }
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
        let releaseLock: ReleaseLock | null = null;
        let stat: Deno.FileInfo;
        try {
            // For metadata checks we always wait indefinitely rather than fail-fast.
            releaseLock = await acquireReadLock(filePath);
            stat = await Deno.stat(filePath);
        } catch {
            if (releaseLock) {
                releaseLock();
            }
            return { status: 'none' };
        } finally {
            if (releaseLock) {
                releaseLock();
            }
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

        const firstPath = fromFullPath < toFullPath ? fromFullPath : toFullPath;
        const secondPath = fromFullPath < toFullPath ? toFullPath : fromFullPath;

        let firstRelease: ReleaseLock | null = null;
        let secondRelease: ReleaseLock | null = null;
        try {
            try {
                firstRelease = await acquireWriteLock(firstPath, this.writeLockTimeoutMs);
                if (secondPath !== firstPath) {
                    secondRelease = await acquireWriteLock(secondPath, this.writeLockTimeoutMs);
                }
            } catch (err) {
                if (err instanceof LockTimeoutError) {
                    return 423;
                }
                throw err;
            }
            await Deno.rename(fromFullPath, toFullPath);
        } catch (err) {
            return (err instanceof Deno.errors.NotFound) ? 404: 500;
        } finally {
            if (secondRelease) {
                secondRelease();
            }
            if (firstRelease) {
                firstRelease();
            }
        }
        return 200;
    }
}

export default dataToSchemaAdapter(fileToDataAdapter(LocalFileAdapterBase));