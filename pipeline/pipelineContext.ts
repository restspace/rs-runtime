import { Url } from "rs-core/Url.ts";
import { MessageFunction } from "rs-core/Service.ts";
import { MessageMethod } from "../../rs-core/Message.ts";

export interface PipelineContext {
    handler: MessageFunction;
    callerUrl?: Url;
    callerMethod?: MessageMethod;
    targetHost?: Url;
    targetHeaders?: Record<string, unknown>;
    outputHeaders?: Record<string, unknown>;
    external?: boolean;
    trace?: boolean;
    traceOutputs?: Record<string, any>;
    path: number[];
    callerLoggerArgs?: string[];
}

export const copyPipelineContext = (context: PipelineContext) => {
    return {
        ...context,
        path: [ ...context.path ]
    };
}