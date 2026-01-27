import { AuthorizationType, Service, ServiceFunction } from "rs-core/Service.ts";
import { Message } from "rs-core/Message.ts";
import { IServiceConfig, PrePost } from "rs-core/IServiceConfig.ts";
import { config } from "./config.ts";
import { mimeHandlers } from "./mimeHandlers.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { pipeline } from "./pipeline/pipeline.ts";
import { handleOutgoingRequest } from "./handleRequest.ts";
import { handleOutgoingRequestWithPrivateServices } from "./handleRequest.ts";
import { pipelineConcat, PipelineSpec } from "rs-core/PipelineSpec.ts";
import { AuthUser } from "./auth/AuthUser.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { upTo } from "rs-core/utility/utility.ts";
import { Source } from "rs-core/Source.ts";

export class ServiceWrapper {
    constructor(public service: Service) {
    }

    private async prePostPipeline(prePost: PrePost, basePath: string, msg: Message, context: ServiceContext<IAdapter>, pipelineSpec?: PipelineSpec, privateServiceConfigs?: Record<string, IServiceConfig>) {
        if (pipelineSpec) {
            let handler = (msg: Message, source?: Source) => handleOutgoingRequest(msg, source, context);
            if (privateServiceConfigs) handler = handleOutgoingRequestWithPrivateServices(basePath, privateServiceConfigs, msg.tenant, context, prePost);
            return await pipeline(msg, pipelineSpec, msg.url, false, handler, context.serviceName);
        }
        return msg;
    }

    /** return a ServiceFunction for an internal, preauthenticated call to a service */
    internal: ServiceFunction = async (msg: Message, context: ServiceContext<IAdapter>, serviceConfig: IServiceConfig) => {
        msg.url.basePathElements = serviceConfig.basePath.split('/').filter((s: string) => s !== '');
        let newMsg = msg.copy();
        try {
            // Expose request-scoped auth/access info to adapters (without services knowing adapter details).
            context.userObj = msg.user;
            context.user = msg.user?.email || context.user;
            context.access = serviceConfig.access;

            const { manifestConfig } = serviceConfig;
            const prePipeline = pipelineConcat(serviceConfig?.prePipeline, manifestConfig?.prePipeline);
            const postPipeline = pipelineConcat(manifestConfig?.postPipeline, serviceConfig?.postPipeline);
            newMsg = await this.prePostPipeline("pre", serviceConfig.basePath, newMsg, context, prePipeline, manifestConfig?.privateServiceConfigs);
            newMsg.applyServiceRedirect();
            context.metadataOnly = newMsg.url.isDirectory && ("$metadataOnly" in newMsg.url.query);

            // Make context.makeRequest star-aware for private services during this invocation
            const originalMakeRequest = context.makeRequest;
            context.makeRequest = (innerMsg, source) => {
                const first = innerMsg.url.pathElements[0] || '';
                const hasPrivate = !!manifestConfig?.privateServiceConfigs;
                if (hasPrivate && first.startsWith('*')) {
                    const handler = handleOutgoingRequestWithPrivateServices(
                        serviceConfig.basePath,
                        manifestConfig!.privateServiceConfigs!,
                        innerMsg.tenant || msg.tenant,
                        context,
                        context.prePost
                    );
                    return handler(innerMsg);
                }
                return originalMakeRequest(innerMsg, source);
            };

            if (newMsg.ok && !newMsg.isRedirect) newMsg = await this.service.func(newMsg, context, serviceConfig);
            if (newMsg.ok && !newMsg.isRedirect) newMsg = await this.prePostPipeline("post", serviceConfig.basePath, newMsg, context, postPipeline, manifestConfig?.privateServiceConfigs);
        } catch (err) {
            if ((err as Error)?.message === 'Not found') {
                newMsg.setStatus(404, 'Not found');
            } else {
                let errStack = '';
                if (err instanceof Error) {
                    errStack = ` at \n${err.stack || ''}`;
                }
                config.logger.error(`error: ${err}${errStack}`, ...msg.loggerArgs(serviceConfig.name));
                newMsg.setStatus(500, 'Internal Server Error');
            }
        }
    
        if (newMsg && !newMsg.ok) {
            config.logger.warning(`Request error for ${msg.method}: ${msg.url}: ${newMsg.status} ${newMsg?.data?.asStringSync() || ''}`, ...msg.loggerArgs(serviceConfig.name));
        }
        newMsg.setHeader('X-Restspace-Service', serviceConfig.name);

        // avoid running a mime handler twice - wasMimeHandled is cleared when the message data is changed
        if (newMsg.data && !newMsg.data.wasMimeHandled) {
            const handler = mimeHandlers[upTo(newMsg.data.mimeType, ';')];
            if (handler) {
                newMsg = await handler(newMsg, msg.url, (innerMsg: Message) => Promise.resolve(this.internal(innerMsg, context, serviceConfig)));
                if (newMsg.data) newMsg.data.wasMimeHandled = true;
            }
        }
        return newMsg;
    }

    private async isPermitted(msg: Message, { access }: IServiceConfig): Promise<[boolean, boolean]> {
        if (!msg.user) return [false, false];

        let roleSet: string;
        let isPublic: boolean;
        switch (await this.service.authType(msg)) {
            case AuthorizationType.read:
                roleSet = access.readRoles;
                isPublic = access.readRoles === 'all';
                break;
            case AuthorizationType.write:
                roleSet = access.writeRoles;
                isPublic = access.writeRoles === 'all';
                break;
            case AuthorizationType.create:
                roleSet = access.createRoles || access.writeRoles;
                isPublic = access.createRoles === 'all';
                break;
            case AuthorizationType.none:
            default:
                roleSet = "all";
                isPublic = true;
                break;
        }
        const authUser = new AuthUser(msg.user);
        return [isPublic, authUser.authorizedFor(roleSet, msg.url.servicePath)];
    }

    // mutates data
    private setCors(data: Message, origin: string) {
        if (origin) {
            data.setHeader('Access-Control-Allow-Origin', origin);
            const defaultAllowHeaders = 'Origin,X-Requested-With,Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Restspace-Request-Mode,X-X';
            const existingAllowHeaders = data.getHeader('Access-Control-Allow-Headers') || '';
            config.logger.info(`existingAllowHeaders: ${existingAllowHeaders}`);
            const defaultHeaders = defaultAllowHeaders.split(',').map(h => h.trim()).filter(h => h.length > 0);
            const existingHeaders = existingAllowHeaders.split(',').map(h => h.trim()).filter(h => h.length > 0);
            const seen = new Set<string>();
            const merged: string[] = [];
            for (const headerName of [ ...defaultHeaders, ...existingHeaders ]) {
                const key = headerName.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(headerName);
                }
            }
            data.setHeader('Access-Control-Allow-Headers', merged.join(','));
            data.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, POST, PUT, PATCH, DELETE');
            data.setHeader('Access-Control-Allow-Credentials', 'true');
            data.setHeader('Access-Control-Expose-Headers', 'X-Restspace-Service,Location,ETag,X-Total-Count');
            data.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        }
        return data;
    }

    private getEtag(msg: Message) {
        const dateModified = msg?.data?.dateModified || new Date(0);
        const size = msg?.data?.size || 0
        return `${dateModified.getTime()}-${size}`;
    }

    private checkMatch(msg: Message): Message {
        if (!msg.ok) return msg;

        const ifMatch = msg.getHeader("If-Match") as string;
        const ifNoneMatch = msg.getHeader("If-None-Match") as string;
        if (ifMatch || ifNoneMatch) {
            const etags = (ifMatch || ifNoneMatch).split(',').map(etag => etag.trim());
            const msgETag = this.getEtag(msg);
            const matches = etags.includes(msgETag);
            if (matches && ifNoneMatch) {
                return msg.setStatus(304, "Not Modified");
            } else if (!matches && ifMatch) {
                if (msg.method === "GET" || msg.method === "HEAD") {
                    if (msg.getHeader("Range")) {
                        return msg.setStatus(416, "Range Not Satisfiable");
                    }
                } else {
                    return msg.setStatus(412, "Precondition Failed");
                }
            }
        }
        return msg;
    }

    private setCache(msg: Message, { caching }: IServiceConfig, isPublic: boolean): Message {
        if (msg.method !== 'GET' || msg.url.isDirectory || !msg.ok) {
            msg.setCaching('none');
            return msg;
        }

        caching = caching || {};

        const cacheControl: string[] = [];
        cacheControl.push(isPublic ? 'public' : 'private');
        if (!caching.cache) {
            cacheControl.push(caching.sendETag ? 'max-age=0' : 'no-cache');
            if (caching.sendETag) cacheControl.push('must-revalidate');
            msg.setHeader("Pragma", "no-cache");
        } else {
            msg.removeHeader("Pragma");
        }
        if (caching.maxAge) {
            cacheControl.push('max-age=' + caching.maxAge);
            const expiry = new Date();
            expiry.setSeconds(expiry.getSeconds() + caching.maxAge);
            msg.setHeader("Expires", expiry.toUTCString());
        }

        if (cacheControl.length) {
            msg.setHeader("Cache-Control", cacheControl.join(', '));
        }
        if (caching.sendETag && msg.ok && msg.data && msg.data.dateModified) {
            msg.setHeader("ETag", this.getEtag(msg));
        }
        return msg;
    }

    /** Return a ServiceFunction for a call to a service coming from an inbound request to the runtime server */
    external: (source: Source) => ServiceFunction = (source: Source) => async (msg: Message, context: ServiceContext<IAdapter>, serviceConfig: IServiceConfig) => {
        const origin = msg.getHeader('origin') || '';
        msg.url.basePathElements = serviceConfig.basePath.split('/').filter((s: string) => s !== '');

        const [isPublic, isPermitted] = await this.isPermitted(msg, serviceConfig);
        
        if (!isPermitted) {
            config.logger.warning(`Unauthorized for ${msg.url}`, ...msg.loggerArgs(serviceConfig.name));
            return this.setCors(msg, origin).setStatus(401, "Unauthorized");
        }
        msg.authenticated = true;

        let msgOut = await this.internal(msg, context, serviceConfig);

        if (source === Source.Outer) return msgOut;

        msgOut = this.setCors(msgOut, origin);

        // Caching headers
        msgOut = this.checkMatch(msgOut);
        msgOut = this.setCache(msgOut, serviceConfig, isPublic);

        return msgOut;
    }
}