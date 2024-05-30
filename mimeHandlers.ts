import { Message } from "rs-core/Message.ts";
import { Url } from "rs-core/Url.ts";
import { DirDescriptor } from "rs-core/DirDescriptor.ts";
import { last, slashTrimLeft } from "rs-core/utility/utility.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";
import { zip } from "./pipeline/zipJoiner.ts"

type MimeHandler = (msg: Message, url: Url, requestInternal: (req: Message) => Promise<Message>) => Promise<Message>;

const generatePaths = async function* (msg: Message, requestInternal?: (req: Message) => Promise<Message>): AsyncGenerator<[ Message, DirDescriptor ]> {
    let dir = ((await msg.data!.asJson()) || []) as DirDescriptor | DirDescriptor[];
    if (Array.isArray(dir)) dir = dir[0];
    yield [ msg, { ...dir } ];
    if (requestInternal) {
        const subdirs = dir.paths.filter(([ p ]) => p.endsWith('/'));
        for (const [ subdir ] of subdirs) {
            const newUrl = msg.url.follow(subdir);
            newUrl.query['$list'] = [ "recursive,details,all" ];
            const msgOut = await requestInternal(msg.copy().setUrl(newUrl).setData(null, ''));
            const dirList = ((await msgOut.data!.asJson()) || []) as DirDescriptor[];
            for (const resDir of dirList) {
                yield [ msgOut, { ...resDir } ];
            }
        }
    }
}

const dirToItems = async (msg: Message, dir: DirDescriptor, requestInternal: (req: Message) => Promise<Message>) => {
    const fetchAllMessages = dir.paths
        .filter(([ path ]) => !path.endsWith('/'))
        .map(([ path ]) => {
            const url = msg.url.copy();
            url.servicePath = dir.path + path;
            return msg.copy().setUrl(url);
        });
    const fullList: Record<string, unknown> = {};
    await Promise.all(fetchAllMessages
        .map(msg => requestInternal(msg)
            .then(msg => msg.data!.asJson().then(data => fullList[slashTrimLeft(dir.path) + msg.url.resourceName] = data))
        ));
    return fullList;
}

const dirToQueue = (basePath: string, msg: Message, dir: DirDescriptor, requestInternal: (req: Message) => Promise<Message>) => {
    if (basePath === '/') basePath = '';
    const fetchAllMessages = dir.paths
        .filter(([ path ]) => !path.endsWith('/'))
        .map(([ path ]) => {
            const url = msg.url.copy();
            url.servicePath = dir.path + path;
            const name = url.servicePath.substring(basePath.length);
            return msg.copy().setUrl(url).setName(name);
        });
    const dirFetchQueue = new AsyncQueue<Message>(fetchAllMessages.length)
    fetchAllMessages
        .forEach(msg => dirFetchQueue.enqueue(requestInternal(msg)));
    return dirFetchQueue;
}

const final = (s: string) => {
    const words = s.split('/');
    return last(words) === '' ? words.slice(-2)[0] + '/' : last(words);
};

const extractFragment: MimeHandler = async (msg, url) => {
    if (url.fragment && msg.data) {
        await msg.data.extractPathIfJson(url.fragment);
    }
    return msg;
}

export const mimeHandlers: { [ mimeType: string ]: MimeHandler } = {
    "application/json": extractFragment,
    "application/schema+json": extractFragment,
    "inode/directory+json": async (msg, url, requestInternal) => {
        const listFlags = (url.query['$list'] || []).join(',') as string;
        let isRecursive = listFlags.includes('recursive');
        const getItems = listFlags.includes('items');
        const details = listFlags.includes('details');
        let pathsOnly = !(details || getItems);
        const allFiles = listFlags.includes('all');
        const fileInfo = listFlags.includes('fileinfo') && pathsOnly;
        const noDirs = listFlags.includes('nodirs');

        const isZip = listFlags.includes('zip');

        const zipQueue = new AsyncQueue<Message>();
        if (isZip) {
            isRecursive = true;
            pathsOnly = true;
        }
        let results = [] as any[];
        let basePath = msg.url.servicePath;
        if (basePath === '/') basePath = '';
        for await (const [ resMsg, resDir ] of generatePaths(msg, isRecursive ? requestInternal : undefined)) {
            if (!resDir) continue;
            if (!allFiles) {
                resDir.paths = resDir.paths.filter(([ p ]) => !final(p).startsWith('.'));
            }
            if (noDirs) {
                resDir.paths = resDir.paths.filter(([ p ]) => !p.endsWith('/'));
            }
            let result = resDir as any;

            // transform resDir to get appropriate list items
            if (getItems) {
                result = await dirToItems(resMsg, resDir, requestInternal);
                results.push(result);
            } else if (isZip) {
                const dirQueue = dirToQueue(msg.url.servicePath, resMsg, resDir, requestInternal);
                zipQueue.enqueue(dirQueue);
                dirQueue.close();
            } else if (pathsOnly) {
                const relPath = (resDir.path === '/' ? '' : resDir.path).substring(basePath.length);
                results = results.concat(resDir.paths.map(([p, ...rest]) => [relPath + p, ...rest]));
            } else {
                results.push(result);
            }
        }

        if (isZip) {
            zipQueue.close();
            let zipMsg = await zip(zipQueue, msg.tenant);
            if (zipMsg === null) zipMsg = msg.setStatus(500, 'Zip output null');
            return zipMsg;
        }

        // transform output list
        if (isRecursive) {
            if (getItems) {
                results = Object.assign(results[0], ...results.slice(1));
            } else if (!fileInfo) {
                // list of lists
                results = results.flatMap(i => i);
            }
        } else {
            if (!pathsOnly) {
                results = results[0];
            } else if (!fileInfo) {
                results = results.map(([ p ]) => p);
            }
        }

        if (getItems) {
            // list of objects
            let obj = results as unknown as Record<string, unknown>;
            const urlRemoveChars = (url.servicePath === '/' ? 0 : url.servicePath.length);
            obj = Object.fromEntries(Object.entries(obj).map(([k, v]) => [ k.substr(urlRemoveChars), v ]));
            return msg.setDirectoryJson(obj);
        }

        return msg.setDirectoryJson(results);
    }
}