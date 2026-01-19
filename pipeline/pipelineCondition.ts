import { evaluate } from 'https://cdn.skypack.dev/bcx-expression-evaluator?dts';
import { Message } from "rs-core/Message.ts";
import * as mimeType from "rs-core/mimeType.ts";
import { matchFirst, scanCloseJsBracket, skipWhitespace } from "rs-core/utility/utility.ts";
import { PipelineContext } from "./pipelineContext.ts";
import { PipelineMode } from "./pipelineMode.ts";

export class PipelineCondition {

    constructor(public exp: string) {
    }

    satisfies(msg: Message, mode: PipelineMode, context: PipelineContext): boolean {
        let status = msg.status;
        if (mode.conditional && msg.data && msg.data.mimeType === "application/json") {
            const err = JSON.parse(msg.data.asStringSync());
            if (err['_errorStatus'] !== undefined) {
                status = err._errorStatus;
            }
        }
        const mime = msg.data?.mimeType;
        const isJson = mimeType.isJson(mime);
        const isText = mimeType.isText(mime);
        const isManage = msg.getHeader('X-Restspace-Request-Mode') === 'manage';
        const callerUrl = context?.callerUrl;
        const msgValues = {
            name: msg.name,
            mime,
            isJson,
            isText,
            isBinary: !(isJson || isText),
            isManage,
            status,
            ok: status === 200 || status === 0,
            method: context.callerMethod?.toUpperCase(),
            subpath: callerUrl && (callerUrl.subPathElementCount === null ? callerUrl.servicePathElements : callerUrl.subPathElements),
            isDirectory: callerUrl && callerUrl.isDirectory,
            user: msg.user,
            header: (hdr: string) => msg.getHeader(hdr),
            body: () => {
                if (!msg.data) {
                    return {};
                } else if (msg.data.data instanceof ArrayBuffer) {
                    return JSON.parse(msg.data.asStringSync());
                } else {
                    throw new Error('Pipeline condition based on message body of message with stream data');
                }
            },
            query: () => {
                Object.fromEntries(Object.entries(msg.url.query).map(([ k, v ]) => [k, v[0]]));
            },
            ...context.variables.getVariablesForScope(msg.name)
        }
        return !!evaluate(this.exp, msgValues);
    }

    static scan(str: string, start: number): [ PipelineCondition | null, number ] {
        let pos = start;
        
        pos = skipWhitespace(str, pos);
        if (pos >= str.length) return [ null, -1 ];
        [ , pos ] = matchFirst(str, pos, [ "if (" ]);
        if (pos < 0) return [ null, -1 ];
        const endPos = scanCloseJsBracket(str, pos, "()");
        if (endPos < 0) return [ null, -1 ];
        return [ new PipelineCondition(str.substring(pos, endPos - 1)), endPos ];
    }
}