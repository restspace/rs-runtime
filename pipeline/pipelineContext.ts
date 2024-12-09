import { Url } from "rs-core/Url.ts";
import { MessageFunction } from "rs-core/Service.ts";
import { MessageMethod } from "rs-core/Message.ts";
import { Limiter } from "rs-core/utility/limitConcurrency.ts";
import { VariableScope } from "rs-core/VariableScope.ts";

export interface PipelineContext {
    handler: MessageFunction;
    callerUrl?: Url;
    callerMethod?: MessageMethod;
    callerTenant: string;
    targetHost?: Url;
    targetHeaders?: Record<string, unknown>;
    outputHeaders?: Record<string, unknown>;
    external?: boolean;
    trace?: boolean;
    traceOutputs?: Record<string, any>;
    path: number[];
    callerLoggerArgs?: string[];
    concurrencyLimiter: Limiter;
    variables: VariableScope;
    serviceName: string;
}

export const copyPipelineContext = (context: PipelineContext) => {
    return {
        ...context,
        path: [ ...context.path ]
    };
}