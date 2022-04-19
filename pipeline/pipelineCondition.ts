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
        const msgValues = {
            name: msg.name,
            mime,
            isJson,
            isText,
            isBinary: !(isJson || isText),
            status,
            ok: status === 200 || status === 0,
            method: context.callerMethod?.toUpperCase()
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