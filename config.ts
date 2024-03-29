import { Modules } from "./Modules.ts";
import { Tenant } from "./tenant.ts";
import * as log from "std/log/mod.ts";
import Ajv from "https://cdn.skypack.dev/ajv?dts";
import * as path from "std/path/mod.ts";
import { LogRecord } from "std/log/logger.ts";
import { Authoriser } from "./auth/Authoriser.ts";
import { IChordServiceConfig } from "rs-core/IServiceConfig.ts";
import { schemaIChordServiceConfig } from "rs-core/IServiceConfig.ts";
import { IChord } from "./IChord.ts";
import { Message } from "rs-core/Message.ts";

export interface Infra {
    adapterSource: string; // cannot be site relative
}

export interface IServerConfig {
    tenancy: "single" | "multi";
    mainDomain: string,
    domainMap: { [domain: string]: string };
    infra: { [ name: string ]: Infra };
    configStore: string;
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
    let [ tenant, username, traceId, spanId ] = rec.args;
    if (!tenant) tenant = 'global';
    if (!username) username = '?';
    if (!traceId) traceId = 'x'.repeat(32);
    if (!spanId) spanId = 'x'.repeat(16);
    return `${severity} ${rec.datetime.toISOString()} ${traceId} ${spanId} ${tenant} ${username} ${rec.msg}`;
}

export type LogLevel = "NOTSET" | "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

// we allow for extra schema properties like 'editor' to direct UI
const ajv = new Ajv({ allErrors: true, strictSchema: false, allowUnionTypes: true });

export const config = {
    server: {} as IServerConfig,
    modules: new Modules(ajv),
    tenants: {} as { [ name: string ]: Tenant },
    logger: log.getLogger(),
    // path.resolves resolves relative to dir of current source file, which is repo root
    fixRelativeToRoot: (pathUrl: string) => pathUrl.startsWith('.') ? path.resolve(pathUrl) : pathUrl,
    ajv,
    jwtExpiryMins: 30,
    getParam: (key: string) => Deno.env.get(key),
    authoriser: new Authoriser(),
    validateChordService: ajv.compile<IChordServiceConfig>(schemaIChordServiceConfig),
    validateChord: ajv.compile<IChord>({
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
        url.startsWith('/') ? "https://" + (primaryDomain || config.tenants[tenant || ''].primaryDomain) + url : url
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