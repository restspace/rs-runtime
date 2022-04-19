import { ISchemaAdapter } from "rs-core/adapter/ISchemaAdapter.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { ItemMetadata } from "rs-core/ItemMetadata.ts";

type IDataAdapterConstructor = new (...args: any[]) => IDataAdapter;

export function dataToSchemaAdapter<TDataAdapter extends IDataAdapterConstructor>(dataAdapter: TDataAdapter) {
    return class DataAsSchemaAdapter extends dataAdapter implements ISchemaAdapter {
        checkSchema(dataset: string): Promise<ItemMetadata> {
            return this.checkKey(dataset, '.schema.json');
        }
        readSchema(dataset: string): Promise<number | Record<string,unknown>> {
            return this.readKey(dataset, '.schema.json');
        }
        writeSchema(dataset: string, schema: Record<string,unknown>): Promise<number> {
            return this.writeKey(dataset, '.schema.json', MessageBody.fromObject(schema));
        }
        instanceContentType(dataset: string, baseUrl: string): Promise<string> {
            const url = [ baseUrl, dataset, '.schema.json' ].filter(s => s !== '').join('/');
            return Promise.resolve(`application/json; schema="${url}"`);
        }
    }
}