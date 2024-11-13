import { Message } from "rs-core/Message.ts";
import { Source } from "rs-core/Source.ts";
import { IServiceConfig, PrePost } from "rs-core/IServiceConfig.ts";
import { config } from "./config.ts";
import { IRawServicesConfig, Tenant } from "./tenant.ts";
import { Url } from "rs-core/Url.ts";
import { slashTrim } from "rs-core/utility/utility.ts";
import { MessageFunction } from "rs-core/Service.ts";
import { BaseContext, contextLoggerArgs } from "rs-core/ServiceContext.ts";

const tenantLoads = {} as Record<string, Promise<void>>;

const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

const tenantLoadTimeoutMs = 500000;

const getTenant = async (url: Url, requestTenant: string) => {
    const tenantLoad = tenantLoads[requestTenant];

    // if we're not the first getTenant call for this tenant, wait for the first call to complete
    // unless we're triggered as part of the first call i.e. source is internal
    if (tenantLoad !== undefined) {
        const urlIsReady = config.tenants[requestTenant]?.pathIsReady(url);
        if (!urlIsReady) await tenantLoads[requestTenant];
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
            
            // specified domains for tenant
            const tenantDomains = Object.entries(config.server.domainMap)
                .filter(([,ten]) => ten === requestTenant)
                .map(([dom,]) => dom);
            // tenant's subdomain of main domain
            tenantDomains.push(`${requestTenant}.${config.server.mainDomain}`);

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
    let serviceName = '?' as string | undefined;
    try {
        const tenantName = tenantFromHostname(msg.getHeader('host') || 'none');
        if (tenantName === null) return msg.setStatus(404, 'Not found');
        const tenant = await getTenant(msg.url, tenantName || 'main');
        msg.tenant = tenant.name;
        msg = await tenant.attachUser(msg);
        let messageFunction: MessageFunction;
        [messageFunction, serviceName] = await tenant.getMessageFunctionByUrl(msg.url, Source.External);
        config.logger.info(`${" ".repeat(msg.depth)}(Incoming) Request ${msg.method} ${msg.url}`, ...msg.loggerArgs(serviceName));
        const msgOut = await messageFunction(msg.callDown());
        msgOut.depth = msg.depth;
        config.logger.info(`${" ".repeat(msg.depth - 1)}(Incoming) Respnse ${msg.method} ${msg.url}`, ...msg.loggerArgs(serviceName));
        msgOut.callUp();
        if (!msgOut.ok) {
            config.logger.info(`${" ".repeat(msg.depth)}Respnse ${msgOut.status} ${await msgOut.data?.asString()} ${msg.method} ${msg.url}`, ...msgOut.loggerArgs(serviceName));
        }
        return msgOut;
    } catch (err) {
        let errStack = '';
        if (err instanceof Error) {
            errStack = ` at \n${err.stack || ''}`;
        }
        config.logger.warning(`request processing failed: ${err}${errStack}`, ...msg.loggerArgs(serviceName));
        return originalMethod === 'OPTIONS'
            ? config.server.setServerCors(msg).setStatus(204)
            : msg.setStatus(500, 'Server error');
    }
};

export const handleOutgoingRequest = async (msg: Message, source = Source.Internal, context?: BaseContext) => {
    const originalMethod = msg.method;
    let tenantName: string | null = '';
    let serviceName = '?' as string | undefined;
    const loggerArgs = context ? contextLoggerArgs(context) : msg.loggerArgs(serviceName);
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
                tenant = await getTenant(msg.url, tenantName || 'main');
                if (tenant.isEmpty) tenantName = null;
            } catch {
                tenantName = null;
            }
        }

        if (tenantName !== null) {
            msg.tenant = tenantName;
            let messageFunction: MessageFunction;
            [messageFunction, serviceName] = await tenant!.getMessageFunctionByUrl(msg.url, source);
            config.logger.info(`${" ".repeat(msg.depth)}Request ${msg.method} ${msg.url}`, ...loggerArgs);
            msgOut = await messageFunction(msg.callDown());
            msgOut.depth = msg.depth;
            config.logger.info(`${" ".repeat(msgOut.depth - 1)}Respnse ${msg.method} ${msg.url}`, ...loggerArgs);
            msgOut.callUp();
        } else {
            config.logger.info(`Request external ${msg.method} ${msg.url}`, ...loggerArgs);
            let resp: Response;

            let msgOut: Message;
            if (config.requestExternal) {
                try {
                    msgOut = await config.requestExternal(msg);
                } catch (err) {
                    config.logger.error(`External request failed: ${err}`, ...loggerArgs);
                    msg.setStatus(500, `External request fail: ${err}`);
                    return msg;
                }
            } else {
                try {
                    resp = await fetch(msg.toRequest());
                } catch (err) {
                    config.logger.error(`External request failed: ${err}`, ...loggerArgs);
                    msg.setStatus(500, `External request fail: ${err}`);
                    return msg;
                }
                msgOut = Message.fromResponse(resp, msg.tenant);
            }
            msgOut.method = msg.method; // slightly pointless
            msgOut.name = msg.name;
            msg.setMetadataOn(msgOut);
            if (msgOut.ok) {
                config.logger.info(`Respnse external ${msg.method} ${msg.url}`, ...loggerArgs);
            } else {
                const body = msgOut.hasData() ? (await msgOut.data!.asString())?.substring(0, 200) : 'none';
                config.logger.warning(`Respnse external ${msg.method} ${msg.url} error status ${msgOut.status} body ${body}`, ...loggerArgs);
            }
            // don't process by mime type on external requests
            if (msgOut.data) msgOut.data.wasMimeHandled = true;
            return msgOut;
        }
        
        if (!msgOut.ok) {
            config.logger.info(` - Status ${msgOut.status} ${await msgOut.data?.asString()} ${msg.method} ${msg.url}`, ...loggerArgs);
        }
        return msgOut;
    } catch (err) {
        let errStack = '';
        if (err instanceof Error) {
            errStack = ` at \n${err.stack || ''}`;
        }
        config.logger.warning(`request processing failed: ${err}${errStack}`, ...loggerArgs);
        return originalMethod === 'OPTIONS' && tenantName
            ? config.server.setServerCors(msg).setStatus(204)
            : msg.setStatus(500, 'Server error');
    }
}

export const handleOutgoingRequestWithPrivateServices = (basePath: string, privateServices: Record<string, IServiceConfig>, tenantName: string, context: BaseContext, prePost?: PrePost) =>
    async (msg: Message) => {
        if (msg.url.pathElements[0]?.startsWith('*')) {
            const privateServiceName = msg.url.pathElements[0];
            const serviceConfig = privateServices[privateServiceName.substring(1)];
            if (!serviceConfig) return msg.setStatus(404, 'Not found');
            
            // url received by private service on msg is made absolute, with basePath set correctly
            // this enables the private service to know from where it was called
            const newUrl = new Url(basePath).follow(msg.url);
            newUrl.scheme = msg.url.scheme;
            newUrl.domain = msg.url.domain;
            newUrl.basePathElements = slashTrim(basePath).split('/').concat([ privateServiceName ]);
            msg.url = newUrl;
            const tenant = config.tenants[tenantName || 'main'];
            const messageFunction = await tenant.getMessageFunctionForService(serviceConfig, Source.Internal, prePost);
            const msgOut = await messageFunction(msg.callDown());
            msgOut.depth = msg.depth;
            msgOut.callUp();
            return msgOut;
        } else {
            return handleOutgoingRequest(msg, Source.Internal, context);
        }
    }

//export const handleWsConnection = (