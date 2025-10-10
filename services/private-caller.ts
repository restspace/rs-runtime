import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

const service = new Service<IAdapter>();

// Calls a private service directly via star path
service.getPath('/direct', async (msg, context: ServiceContext<IAdapter>) => {
  const m = new Message('/', msg.tenant, 'GET', msg);
  m.url.pathElements = ['*serv1', 'xyz'];
  return context.makeRequest(m);
});

// Calls a private service directory (ensure trailing slash semantics are preserved)
service.getPath('/dir', async (msg, context: ServiceContext<IAdapter>) => {
  const m = new Message('/', msg.tenant, 'GET', msg);
  m.url.pathElements = ['*serv1', 'dir', ''];
  return context.makeRequest(m);
});

export default service;