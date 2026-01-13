import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

const service = new Service<IAdapter>();

// Calls a private service directly via star path
service.getPath('/direct', async (msg, context: ServiceContext<IAdapter>) => {
  const queryStr = msg.url.queryString ? `?${msg.url.queryString}` : '';
  const m = new Message(`/*serv1/xyz${queryStr}`, msg.tenant, 'GET', msg);
  return context.makeRequest(m);
});

// Calls a private service directory (ensure trailing slash semantics are preserved)
service.getPath('/dir', async (msg, context: ServiceContext<IAdapter>) => {
  const queryStr = msg.url.queryString ? `?${msg.url.queryString}` : '';
  const m = new Message(`/*serv1/dir/${queryStr}`, msg.tenant, 'GET', msg);
  return context.makeRequest(m);
});

export default service;