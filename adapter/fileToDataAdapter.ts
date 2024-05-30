import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { ItemMetadata } from "rs-core/ItemMetadata.ts";
import { pathCombine } from "rs-core/utility/utility.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";

type IFileAdapterConstructor = new (...args: any[]) => IFileAdapter;

export function fileToDataAdapter<TFileAdapter extends IFileAdapterConstructor>(fileAdapter: TFileAdapter) {
    return class FileAsDataAdapter extends fileAdapter implements IDataAdapter {
        readKey: (dataset: string, key: string) => Promise<Record<string,unknown> | number> =
            async (dataset: string, key: string) => {
                const data = await this.read(pathCombine(dataset, key), [ 'json' ]); // TODO extend args to include extensions
                return data.ok ? ((await data.asJson()) || {}) : data.statusCode;
            };

        writeKey: (dataset: string, key: string, data: MessageBody) => Promise<number> =
            (dataset: string, key: string, data: MessageBody) => this.write(pathCombine(dataset, key), data, [ 'json' ]);

        deleteKey: (dataset: string, key: string) => Promise<number> =
            (dataset: string, key: string) => this.delete(pathCombine(dataset, key), [ 'json' ]);

        listDataset: (dataset: string, take?: number, skip?: number, getUpdateTime?: boolean) => Promise<PathInfo[] | number> =
            async (dataset: string, _take = 1000, _skip = 0, getUpdateTime?: boolean) => {
                const msgBody = await this.readDirectory(dataset || '/', getUpdateTime);
                if (!msgBody.ok) {
                    if (msgBody.statusCode === 404) {
                        return [];
                    } else {
                        return msgBody.statusCode;
                    }
                }
                const str = await msgBody.asString();
                const paths = ((str && JSON.parse(str)) || []) as PathInfo[];
                return paths;
            };
        
        deleteDataset: (dataset: string) => Promise<number> =
            (dataset: string) => this.deleteDirectory(dataset, '.schema.json');
        
        checkKey: (dataset: string, key: string) => Promise<ItemMetadata> =
            (dataset: string, key: string) => this.check(pathCombine(dataset, key), [ 'json' ]);
    }
}