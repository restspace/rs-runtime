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
import { Message } from "../rs-core/Message.ts";

export interface Infra {
    adapterSource: string;
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
    const dt = rec.datetime;
    const hr = dt.getHours().toString().padStart(2, '0');
    const mn = dt.getMinutes().toString().padStart(2, '0');
    const sc = dt.getSeconds().toString().padStart(2, '0');
    const ms = dt.getMilliseconds().toString().padStart(3, '0');
    return `${hr}:${mn}:${sc}:${ms} ${rec.msg}`;
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
    requestExternal: (msg: Message) => msg.requestExternal()
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