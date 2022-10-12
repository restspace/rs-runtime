import { Message } from "rs-core/Message.ts";
import { Source } from "rs-core/Source.ts";
import { IServiceConfig, PrePost } from "rs-core/IServiceConfig.ts";
import { config } from "./config.ts";
import { IRawServicesConfig, Tenant } from "./tenant.ts";

const tenantLoads = {} as Record<string, Promise<void>>;

const getTenant = async (requestTenant: string) => {
    const tenantLoad = tenantLoads[requestTenant];
    if (tenantLoad !== undefined) {
        await tenantLoads[requestTenant];
    }

    if (!config.tenants[requestTenant]) {
        try {
            config.logger.debug(`Start -- load tenant ${requestTenant}`);
            let resolveLoad = null as (() => void) | null ;
            tenantLoads[requestTenant] = new Promise<void>(resolve => resolveLoad = resolve); // block reentry
            // get the spec for the adapter to access the store where we can find services.json(s)
            const tenantAdapter = await config.modules.getConfigAdapter(requestTenant);
            const servicesRes = await tenantAdapter.read('services.json');
            if (!servicesRes.ok) {
                throw new Error('Could not read services.json');
            }
            const servicesConfig = await servicesRes.asJson() as IRawServicesConfig;
            const tenantDomains = Object.entries(config.server.domainMap)
                .filter(([,ten]) => ten === requestTenant)
                .map(([dom,]) => dom);
            config.tenants[requestTenant] = new Tenant(requestTenant, servicesConfig, tenantDomains);
            await config.tenants[requestTenant].init();
            config.logger.info(`Loaded tenant ${requestTenant} successfully`);
            if (resolveLoad) resolveLoad(); // allow reentry
        } catch (err) {
            config.logger.error(`Failed to load services for tenant ${requestTenant}: ${err}`);
            config.tenants[requestTenant] = new Tenant(requestTenant, { services: {} }, []); // empty tenant
            throw err;
        }
    }

    return config.tenants[requestTenant];
}

const tenantFromHostname = (hostname: string): string | null => {
  const domainParts = hostname.split('.');
  if (config.server.tenancy === 'single') {
      return '';
  } else if (config.server.domainMap && config.server.domainMap[hostname]) {
      return config.server.domainMap[hostname];
  } else {
      const mainDomain: string[] = [];
      mainDomain.unshift(domainParts.pop() as string);
      mainDomain.unshift(domainParts.pop() as string);
      if (mainDomain.join('.').toLowerCase() !== config.server.mainDomain.toLowerCase()) {
          return null;
      }
      return domainParts.join('.');
  }
}

export const handleIncomingRequest = async (msg: Message) => {
    const originalMethod = msg.method;
    try {
        const tenantName = tenantFromHostname(msg.getHeader('host') || 'none');
        if (tenantName === null) return msg.setStatus(404, 'Not found');
        const tenant = await getTenant(tenantName || 'main');
        msg.tenant = tenant.name;
        msg = await tenant.attachUser(msg);
        config.logger.info(`${" ".repeat(msg.depth)}Request (${tenantName}) by ${msg.user?.email || '?'} ${msg.method} ${msg.url}`);
        const messageFunction = await tenant.getMessageFunctionByUrl(msg.url, Source.External);
        const msgOut = await messageFunction(msg.callDown());
        msgOut.depth = msg.depth;
        msgOut.callUp();
        if (!msgOut.ok) {
            config.logger.info(` - Status ${msgOut.status} ${await msgOut.data?.asString()} (${tenantName}) ${msg.method} ${msg.url}`);
        }
        return msgOut;
    } catch (err) {
        config.logger.warning(`request processing failed: ${err}`);
        return originalMethod === 'OPTIONS'
            ? config.server.setServerCors(msg).setStatus(204)
            : msg.setStatus(500, 'Server error');
    }
};

export const handleOutgoingRequest = async (msg: Message, source = Source.Internal) => {
    const originalMethod = msg.method;
    let tenantName: string | null = '';
    try {
        if (msg.url.domain === '' || msg.url.domain === undefined) {
            tenantName = msg.tenant;
            if (msg.url.isRelative) throw new Error(`Cannot request a relative url ${msg.url}`);
        } else {
            tenantName = tenantFromHostname(msg.url.domain);
        }

        let msgOut: Message;
        if (tenantName !== null) {
            const tenant = await getTenant(tenantName || 'main');
            config.logger.info(`${" ".repeat(msg.depth)}Request (${tenantName}) ${msg.method} ${msg.url}`);
            msg.tenant = tenantName;
            const messageFunction = await tenant.getMessageFunctionByUrl(msg.url, source);
            msgOut = await messageFunction(msg.callDown());
            msgOut.depth = msg.depth;
            msgOut.callUp();
        } else {
            config.logger.info(`Request external ${msg.method} ${msg.url}`);
            msgOut = await config.requestExternal(msg);
        }
        
        if (!msgOut.ok) {
            config.logger.info(` - Status ${msgOut.status} ${await msgOut.data?.asString()} (${tenantName}) ${msg.method} ${msg.url}`);
        }
        return msgOut;
    } catch (err) {
        config.logger.warning(`request processing failed: ${err}`);
        return originalMethod === 'OPTIONS' && tenantName
            ? config.server.setServerCors(msg).setStatus(204)
            : msg.setStatus(500, 'Server error');
    }
}

export const handleOutgoingRequestFromPrivateServices = (prePost: PrePost, privateServices: Record<string, IServiceConfig>, tenantName: string) =>
    async (msg: Message) => {
        if (msg.url.isRelative) {
            const privateServiceName = msg.url.pathElements[0];
            const serviceConfig = privateServices[privateServiceName];
            if (!serviceConfig) return msg.setStatus(404, 'Not found');
            msg.url.basePathElements = [ privateServiceName ]; // sets service path to path after service name
            const tenant = config.tenants[tenantName || 'main'];
            const messageFunction = await tenant.getMessageFunctionForService(serviceConfig, Source.Internal, prePost);
            const msgOut = await messageFunction(msg.callDown());
            msgOut.depth = msg.depth;
            msgOut.callUp();
            return msgOut;
        } else {
            return handleOutgoingRequest(msg);
        }
    }

//export const handleWsConnection = (