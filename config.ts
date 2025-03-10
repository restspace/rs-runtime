import { Modules } from "./Modules.ts";
import { Tenant } from "./tenant.ts";
import * as log from "std/log/mod.ts";
import { Validate, validator } from "https://cdn.skypack.dev/@exodus/schemasafe?dts";
import * as path from "std/path/mod.ts";
import { LogRecord } from "std/log/logger.ts";
import { Authoriser } from "./auth/Authoriser.ts";
import { schemaIChordServiceConfig } from "rs-core/IServiceConfig.ts";
import { Message } from "rs-core/Message.ts";
import { stripUndefined } from "rs-core/utility/schema.ts";

export interface Infra {
    adapterSource: string; // cannot be site relative
}

export interface IServerConfig {
    tenancy: "single" | "multi";
    mainDomain: string,
    domainMap: { [domain: string]: string };
    infra: { [ name: string ]: Infra };
    configStore: string;
    stateStore: string;
    incomingAlwaysHttps?: boolean;
    setServerCors(msg: Message): Message;
}

const formatter = (rec: LogRecord) => {
    let severity = 'DEBUG';
    switch (rec.levelName) {
        case "NOTSET":
            severity = "TRACE";
            break;
        case "INFO":
            severity = "INFO ";
            break;
        case "WARNING":
            severity = "WARN ";
            break;
        case "ERROR":
            severity = "ERROR";
            break;
        case "CRITICAL":
            severity = "FATAL";
            break;
    }
    let [ tenant, service, username, traceId, spanId ] = rec.args;
    if (!tenant) tenant = 'global';
    if (!service) service = '?'; else service = (service as string).replace(/ /g, '_');
    if (!username) username = '?';
    if (!traceId) traceId = 'x'.repeat(32);
    if (!spanId) spanId = 'x'.repeat(16);
    return `${severity} ${rec.datetime.toISOString()} ${traceId} ${spanId} ${tenant} ${service} ${username} ${rec.msg}`;
}

export type LogLevel = "NOTSET" | "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

// we allow for extra schema properties like 'editor' to direct UI
const defaultValidator = (schema: any) => {
    const v = validator(schema, { includeErrors: true, allErrors: true, allowUnusedKeywords: true });
    const v2 = ((data: any) => {
        const newData = stripUndefined(data);
        return v(newData);
    }) as unknown as Validate;
    v2.toModule = v.toModule;
    v2.toJSON = v.toJSON;
    
    return v2;
};

export class RequestAbortActions {
    actions: Record<string, (() => void)[]> = {};
    add(id: string, action: () => void) {
        if (this.actions[id] === undefined) {
            this.actions[id] = [ action ];
        } else {
            this.actions[id].push(action);
        }
    }
    abort(id: string) {
        if (this.actions[id]) this.actions[id].forEach(action => action());
    }
    clear(id: string) {
        if (id) delete this.actions[id];
    }
}

export const config = {
    server: {} as IServerConfig,
    modules: new Modules(defaultValidator),
    tenants: {} as { [ name: string ]: Tenant },
    logger: log.getLogger(),
    // path.resolves resolves relative to dir of current source file, which is repo root
    fixRelativeToRoot: (pathUrl: string) => pathUrl.startsWith('.') ? path.resolve(pathUrl) : pathUrl,
    defaultValidator,
    jwtExpiryMins: 30,
    getParam: (key: string) => Deno.env.get(key),
    authoriser: new Authoriser(),
    validateChordService: defaultValidator(schemaIChordServiceConfig),
    validateChord: defaultValidator({
        type: "object",
        properties: {
            id: { type: "string" },
            newServices: {
                type: "array",
                items: {
                    schemaIChordServiceConfig
                }
            }
        }
    }),
    requestExternal: null as null | ((msg: Message) => Promise<Message>),
    canonicaliseUrl: (url: string, tenant?: string, primaryDomain?: string) =>
        url.startsWith('/') ? "https://" + (primaryDomain || config.tenants[tenant || ''].primaryDomain) + url : url,
    requestAbortActions: new RequestAbortActions()
}

export const setupLogging = async (level: LogLevel) => {
    await log.setup({
        handlers: {
            console: new log.handlers.ConsoleHandler(level, { formatter }),
            file: new log.handlers.RotatingFileHandler(level, {
                maxBytes: 512 * 1024,
                maxBackupCount: 5,
                filename: './main.log',
                formatter
            })
        },
        loggers: {
            default: {
                level,
                handlers: [ 'console', 'file' ]
            }
        }
    });
    config.logger = log.getLogger();
}