import { BaseContext } from "rs-core/ServiceContext.ts";
import { config, Infra } from "./config.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import { fileToDataAdapter } from "./adapter/fileToDataAdapter.ts";

export const getStateDataAdapter = async (context: BaseContext) => {
    if (!config.server.stateStore || !config.server.infra[config.server.stateStore]) {
        return undefined;
    }
    const stateStoreAdapterSpec = { ...config.server.infra[config.server.stateStore] };
    (stateStoreAdapterSpec as Infra & { basePath: '/_state' }).basePath = "/_state";
    let stateAdapter = await config.modules.getAdapter<IDataAdapter | IFileAdapter>(stateStoreAdapterSpec.adapterSource, context, stateStoreAdapterSpec);
    if ((stateAdapter as IFileAdapter).read) {
        // in this case, build a dataadapter from the fileadapter
        const fileAdapter = stateAdapter as IFileAdapter;
        const fileAdapterConstructor = fileAdapter.constructor as new (...args: any[]) => IFileAdapter;
        const stateAdapterConstructor = fileToDataAdapter(fileAdapterConstructor);
        stateAdapter = new stateAdapterConstructor(context, stateStoreAdapterSpec);
    }
    return stateAdapter as IDataAdapter;
}