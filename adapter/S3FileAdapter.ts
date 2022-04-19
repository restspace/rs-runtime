import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { ItemMetadata } from "rs-core/ItemMetadata.ts";
import { arrayify, last, pathCombine, slashTrim } from "rs-core/utility/utility.ts";
import * as path from "std/path/mod.ts";
import { toBlockChunks } from "rs-core/streams/streams.ts";
import { readableStreamFromIterable } from "std/io/streams.ts";
import { fileToDataAdapter } from "./fileToDataAdapter.ts";
import { dataToSchemaAdapter } from "./dataToSchemaAdapter.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Message } from "rs-core/Message.ts";
import { parse } from "https://deno.land/x/xml/mod.ts";
import { node } from "https://deno.land/x/xml@2.0.4/utils/types.ts";
import { Url } from "../../rs-core/Url.ts";

export interface S3FileAdapterProps {
    rootPath: string;
    bucketName: string;
    region: string;
    tenantDirectories?: boolean;
	secretAccessKey?: string;
	accessKeyId?: string;
}

interface ListItem {
    key: string,
    name: string,
    lastModified: Date | undefined,
    size: number | undefined
}

interface Contents {
	Key: string,
	LastModified: string,
	Size: number
}

interface CommonPrefix {
	Prefix: string
}

class S3FileAdapterBase implements IFileAdapter {
    basePath: string;
    bucketName: string;
    aws4ProxyAdapter: IProxyAdapter | null = null;

    constructor(public context: AdapterContext, public props: S3FileAdapterProps) {
        this.basePath = props.rootPath;
        this.bucketName = props.bucketName;
    }

	async ensureProxyAdapter() {
		this.aws4ProxyAdapter = await this.context.getAdapter<IProxyAdapter>("./adapter/AWS4ProxyAdapter.ts", {
			service: "s3",
			region: this.props.region,
			secretAccessKey: this.props.secretAccessKey,
			accessKeyId: this.props.accessKeyId,
			urlPattern: `https://${this.bucketName}.s3.amazonaws.com/$P*`
		});
	}

	async processForAws(msg: Message): Promise<Message> {
		await this.ensureProxyAdapter();
		const msgOut = await this.aws4ProxyAdapter!.buildMessage(msg);
		return msgOut;
	}

    canonicalisePath(path: string): string {
        return path.replace(/[^0-9a-zA-Z!_.*'()/-]/g, match => match === '~' ? '%7E' : encodeURIComponent(match));
    }

    queryCanonicalisePath(path: string): string {
        return path;
    }

    decanonicalisePath(path: string): string {
        return decodeURIComponent(path.replace('%7E', '~'));
    }

	getPathParts(reqPath: string, extensions?: string[], forDir?: boolean, forQuery?: boolean): [string, string] {
        reqPath = reqPath.split('?')[0]; // remove any query string
        let fullPath = pathCombine(this.basePath, decodeURI(reqPath));
        if (fullPath.startsWith('/')) fullPath = fullPath.substr(1);
        if (fullPath.endsWith('/')) {
			forDir = true;
			fullPath = fullPath.slice(0, -1);
		}
        const transPath = forQuery ? this.queryCanonicalisePath(fullPath) : this.canonicalisePath(fullPath);
        const pathParts = transPath.split('/');
        if (this.props.tenantDirectories) pathParts.unshift(this.context.tenant);

        let ext = '';
        if (!forDir) {
            const dotParts = last(pathParts).split('.');
			extensions = extensions || [];
            if (extensions.length && (dotParts.length === 1 || extensions.indexOf(last(dotParts)) < 0)) {
                ext = extensions[0];
            } else if (dotParts.length > 1) {
                ext = dotParts.pop()!;
                pathParts[pathParts.length - 1] = dotParts.join('.');
            }
        }
        
        let filePath = pathParts.join('/');
        if (filePath === '.') filePath = '';
        return [ filePath, ext ];
    }

    getPath(reqPath: string, extensions?: string[], forDir?: boolean, forQuery?: boolean): string {
        const [ filePath, ext ] = this.getPathParts(reqPath, extensions, forDir, forQuery);
        return filePath + (ext ? '.' + ext : '');
    }

    async read(readPath: string, extensions?: string[], startByte?: number, endByte?: number): Promise<MessageBody> {
        const getParams = {
            bucket: this.bucketName,
            key: this.getPath(readPath, extensions)
        };
		const s3Msg = new Message(getParams.key, this.context.tenant, "GET");

        if (startByte || endByte) {
            const range = `bytes=${startByte ?? ''}-${endByte ?? ''}`;
            s3Msg.setHeader('Range', range);
        }

        const msgSend = await this.processForAws(s3Msg);
		const msgOut = await this.context.makeRequest(msgSend);
        msgOut.data!.statusCode = msgOut.status;
        return msgOut.data!;
    }

    async write(path: string, data: MessageBody, extensions?: string[]) {
        const key = this.getPath(path, extensions);
		const s3Msg = new Message(key, this.context.tenant, "PUT");
		s3Msg.data = data;
		const msgSend = await this.processForAws(s3Msg);

        try {
			const msgOut = await this.context.makeRequest(msgSend);
			if (!msgOut.ok) {
				console.log('write error: ' + (await msgOut.data?.asString()));
			}
			if (msgOut.data) await msgOut.data.ensureDataIsArrayBuffer();
            return msgOut.status || 500;
        } catch (err) {
            console.log(err);
            return 500;
        }
    }

    async delete(path: string, extensions?: string[]) {
        const deleteParams = {
            bucket: this.bucketName,
            key: this.getPath(path, extensions)
        };

        const metadata = await this.check(path, extensions);
        if (metadata.status === "none") return 404;

		const s3Msg = new Message(deleteParams.key, this.context.tenant, "DELETE");
		const msgSend = await this.processForAws(s3Msg);

        try {
            const msgOut = await this.context.makeRequest(msgSend);
			if (msgOut.data) await msgOut.data.ensureDataIsArrayBuffer();
            return msgOut.ok ? 200 : msgOut.status;
        } catch (err) {
            console.log(err);
            return 500;
        }
    }

    protected async* listPrefixed(filePath: string, maxKeys?: number) {
		const url = new Url("/?list-type=2");
        if (maxKeys) url.query['max-keys'] = [ maxKeys.toString() ];
		if (filePath) url.query['prefix'] = [ filePath ];
        try {
            url.query["delimiter"] = [ "/" ];
			const s3Msg = new Message(url, this.context.tenant, "GET");
			const sendMsg = await this.processForAws(s3Msg);

            const msgOut = await this.context.makeRequest(sendMsg);
            if (!msgOut.ok) console.log(await msgOut.data!.asString());
            const status = msgOut.status;
            if (status && status !== 200) return status;
			const text = await msgOut.data!.asString();
			const output = parse(text!);
			const contents = (output?.['ListBucketResult'] as node)?.['Contents'] as Contents | Contents[];
            for (const item of arrayify(contents)) {
                yield {
                    key: this.decanonicalisePath(item.Key || ''),
                    name: this.decanonicalisePath(last((item.Key || '').split('/'))),
                    lastModified: new Date(item.LastModified),
                    size: item.Size
                } as ListItem;
            }
			const commonPrefixes = (output?.['ListBucketResult'] as node)?.['CommonPrefixes'] as CommonPrefix | CommonPrefix[];
            for (const item of arrayify(commonPrefixes)) {
                yield {
                    key: this.decanonicalisePath(item.Prefix || ''),
                    name: this.decanonicalisePath((item.Prefix || '').split('/').slice(-2, -1)[0] + '/'),
                    lastModified: undefined,
                    size: undefined
                } as ListItem;
            }

        } catch (err) {
            console.log(err);
            return 500;
        }
    }

    protected async* jsonStreamPrefixed(filePath: string, maxKeys?: number) {
		yield '[';
        let first = true;
        for await (const item of this.listPrefixed(filePath, maxKeys)) {
            let modifiedStr = '';
            if (item.name.endsWith('/') && item.lastModified) {
                modifiedStr = "," + item.lastModified.getTime().toString();
            }
            yield `${first ? '': ','} [ "${item.name}"${modifiedStr} ]`;
            first = false;
        }
		yield ']';
    }

    readDirectory(readPath: string, getUpdateTime = false) {
        const filePath = this.getPath(readPath, undefined, true, true) + '/';

        const blockIter = toBlockChunks(this.jsonStreamPrefixed(filePath));

        return Promise.resolve(new MessageBody(readableStreamFromIterable(blockIter), 'text/plain').setIsDirectory());
    }

    async deleteDirectory(path: string, deleteableFileSuffix = ''): Promise<number> {
        const filePath = this.getPath(path, undefined, true);

        const files = this.listPrefixed(filePath);
        let file = await files.next();
        if (file.done) return 200; // delete non-existent dir is 200

        if (deleteableFileSuffix !== '*') {
            while (!file.done) {
                if (file.value.name.includes('/') ||
                    !(deleteableFileSuffix && file.value.name.endsWith(deleteableFileSuffix)))
                    return 400;
                file = await files.next();
            }
        }
        
        return 200;
    }

    async check(path: string, extensions?: string[]): Promise<ItemMetadata> {
        const fullPath = this.getPath(path, extensions, undefined, true);
        const files = this.listPrefixed(fullPath, 1);
        const file = await files.next();
        const item = file.done ? null : file.value;
        const deFullPath = this.decanonicalisePath(fullPath);
        let status : "none" | "directory" | "file" = "none";
        if (item != null) {
            if (item.key === deFullPath) { // exact match, depends on canonicalisePath not losing information
                status = "file";
            } else if ((path.endsWith('/') && item.key !== deFullPath) || ((deFullPath + '/') === item.key)) {
                status = "directory";
            } else {
                status = "none";
            }
        } else {
            return { status: "none" };
        }

        switch (status) {
            case "none":
                return { status };
            case "directory":
                return { status, dateModified: item.lastModified };
            case "file":
                return { status, size: item.size!, dateModified: item.lastModified! };
        }
    }
}

export default dataToSchemaAdapter(fileToDataAdapter(S3FileAdapterBase));