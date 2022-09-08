import { Message } from "rs-core/Message.ts";
import { Url } from "rs-core/Url.ts";
import { DirDescriptor } from "rs-core/DirDescriptor.ts";
import { getProp, last, slashTrimLeft } from "rs-core/utility/utility.ts";
import { makeKeywordArgs } from "https://deno.land/x/nunjucks@3.2.3/src/runtime.js";

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
                resDir.paths = resDir.paths.map(([ p, ...rest ]) => [ subdir + p, ...rest ]);
                yield [ msgOut, { ...resDir } ];
            }
        }
    }
}

const dirToItems = async (msg: Message, dir: DirDescriptor, requestInternal: (req: Message) => Promise<Message>) => {
    const fetchAllMessages = dir.paths
        .filter(([ path ]) => !path.endsWith('/'))
        .map(([ path ]) => msg.copy().setUrl(msg.url.follow(last(path.split('/')))));
    const fullList: Record<string, unknown> = {};
    await Promise.all(fetchAllMessages
        .map(msg => requestInternal(msg)
            .then(msg => msg.data!.asJson().then(data => fullList[slashTrimLeft(dir.path) + msg.url.resourceName] = data))
        ));
    return fullList;
}

const final = (s: string) => {
    const words = s.split('/');
    return last(words) === '' ? words.slice(-2)[0] + '/' : last(words);
};

const extractFragment: MimeHandler = async (msg, url) => {
    console.log(`>> url: ${url} hasData: ${!!msg.data}`);
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
        if (isZip) {
            isRecursive = true;
            pathsOnly = true;
        }
        let results = [] as any[];
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
            } else if (pathsOnly) {
                results = results.concat(resDir.paths);
            } else {
                results.push(result);
            }
        }

        // transform output list
        if (isRecursive) {
            if (getItems) {
                results = Object.assign(results[0], ...results.slice(1));
            } else if (!fileInfo) {
                // list of lists
                results = results.flatMap(i => i);
            }
            if (details) {
                results.forEach((r: DirDescriptor) => r.paths = r.paths.map(([ p, ...rest ]) => [
                    final(p),
                    ...rest
                ]));
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