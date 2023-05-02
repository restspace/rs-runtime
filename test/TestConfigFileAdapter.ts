import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { ItemMetadata } from "rs-core/ItemMetadata.ts";
import { IServicesConfig } from "../tenant.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export const testServicesConfig: { [ tenant: string ]: IServicesConfig } = {};

export default class TestConfigFileAdapter implements IFileAdapter {
    constructor(public context: AdapterContext) {
    }

    readDirectory: (path: string) => Promise<MessageBody> = () => Promise.resolve(new MessageBody(null));
    write: (path: string,data: MessageBody) => Promise<number> = () => Promise.resolve(0);
    delete: (path: string) => Promise<number> = () => Promise.resolve(0);
    deleteDirectory: (path: string,deleteableFileSuffix?: string|undefined) => Promise<number> = () => Promise.resolve(0);
    check: (path: string) => Promise<ItemMetadata> = () => Promise.resolve({ status: 'none' });

    read(): Promise<MessageBody> {
        let res: MessageBody;
        if (testServicesConfig[this.context.tenant]) {
            res = MessageBody.fromObject(testServicesConfig[this.context.tenant]);
        } else {
            res = MessageBody.fromError(404, 'Not found');
        }
        return Promise.resolve(res);
    }
}