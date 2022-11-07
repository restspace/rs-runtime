import { Message } from "rs-core/Message.ts";
import { Source } from "rs-core/Source.ts";
import { IServiceConfig, PrePost } from "rs-core/IServiceConfig.ts";
import { config } from "./config.ts";
import { IRawServicesConfig, Tenant } from "./tenant.ts";
import { NodeResolveLoader } from "https://deno.land/x/nunjucks@3.2.3/src/node_loaders.js";

const tenantLoads = {} as Record<string, Promise<void>>;

const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

const tenantLoadTimeoutMs = 5000;

const getTenant = async (requestTenant: string) => {
    const tenantLoad = tenantLoads[requestTenant];
    if (tenantLoad !== undefined) {
        await tenantLoads[requestTenant];
    }

    if (!config.tenants[requestTenant]) {
        // the resolve function which resolves the promise on which any subsequent getTenant calls
        // will block until the first getTenant call for a tenant succeeds, to ensure only the first
        // getTenant actually does the tenant loading.
        let resolveLoad = null as (() => void) | null;
        let timeoutHandle = null as number | null;
        try {
            config.logger.debug(`Start -- load tenant ${requestTenant}`, requestTenant);
            tenantLoads[requestTenant] = new Promise<void>(resolve => resolveLoad = resolve); // block reentry
            timeoutHandle = setTimeout(() => {
                if (resolveLoad) {
                    resolveLoad();
                }
                config.logger.error(`Timeout loading services for tenant ${requestTenant}`, requestTenant);
                config.tenants[requestTenant] = new Tenant(requestTenant, { services: {} }, []); // empty tenant
                timeoutHandle = null;
            }, tenantLoadTimeoutMs);

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
            config.logger.info(`Loaded tenant ${requestTenant} successfully`, requestTenant);
        } catch (err) {
            config.logger.error(`Failed to load services for tenant ${requestTenant}: ${err}`, requestTenant);
            config.tenants[requestTenant] = new Tenant(requestTenant, { services: {} }, []); // empty tenant
            throw err;
        } finally {
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            if (resolveLoad) resolveLoad(); // allow reentry
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
        config.logger.info(`${" ".repeat(msg.depth)}Request ${msg.method} ${msg.url}`, ...msg.loggerArgs());
        const messageFunction = await tenant.getMessageFunctionByUrl(msg.url, Source.External);
        const msgOut = await messageFunction(msg.callDown());
        msgOut.depth = msg.depth;
        config.logger.info(`${" ".repeat(msg.depth)}Respnse ${msg.method} ${msg.url}`, ...msg.loggerArgs());
        msgOut.callUp();
        if (!msgOut.ok) {
            config.logger.info(`${" ".repeat(msg.depth)}Respnse ${msgOut.status} ${await msgOut.data?.asString()} ${msg.method} ${msg.url}`, ...msgOut.loggerArgs());
        }
        return msgOut;
    } catch (err) {
        config.logger.warning(`request processing failed: ${err}`, ...msg.loggerArgs());
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
        let tenant: Tenant;
        if (tenantName !== null) {
            try {
                tenant = await getTenant(tenantName || 'main');
                if (tenant.isEmpty) tenantName = null;
            } catch {
                tenantName = null;
            }
        }

        if (tenantName !== null) {
            config.logger.info(`${" ".repeat(msg.depth)}Request ${msg.method} ${msg.url}`, ...msg.loggerArgs());
            msg.tenant = tenantName;
            const messageFunction = await tenant!.getMessageFunctionByUrl(msg.url, source);
            msgOut = await messageFunction(msg.callDown());
            msgOut.depth = msg.depth;
            config.logger.info(`${" ".repeat(msgOut.depth)}Respnse ${msg.method} ${msg.url}`, ...msg.loggerArgs());
            msgOut.callUp();
        } else {
            config.logger.info(`Request external ${msg.method} ${msg.url}`, ...msg.loggerArgs());
            msgOut = await config.requestExternal(msg);
            config.logger.info(`Respnse external ${msg.method} ${msg.url}`, ...msg.loggerArgs());
        }
        
        if (!msgOut.ok) {
            config.logger.info(` - Status ${msgOut.status} ${await msgOut.data?.asString()} ${msg.method} ${msg.url}`, ...msgOut.loggerArgs());
        }
        return msgOut;
    } catch (err) {
        config.logger.warning(`request processing failed: ${err}`, ...msg.loggerArgs());
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