import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { getExtension, isJson, isText } from "rs-core/mimeType.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";

const service = new Service<IDataAdapter, IServiceConfig>();

service.post(async (msg, _context, config) => {

});

export default service;