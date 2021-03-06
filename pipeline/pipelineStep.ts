import { PipelineContext } from "./pipelineContext.ts";
import { PipelineCondition } from "./pipelineCondition.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";
import { Message } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";
import { matchFirst, scanFirst, upTo } from "rs-core/utility/utility.ts";
import { PipelineMode } from "./pipelineMode.ts";

export enum Externality { External, Outer, Internal }

export class PipelineStep {
    condition: PipelineCondition | null = null;
    spec = '';
    rename = '';
    tryMode = false;
    method = '';

    constructor(public step: string) {
        let pos = 0;
        step = step.trim();
        let [ match, posNew ] = matchFirst(step, pos, [ "try" ]);
        if (match === "try") {
            this.tryMode = true;
            pos = posNew;
        }

        let conditionPart: PipelineCondition | null;
        [ conditionPart, posNew ] = PipelineCondition.scan(step, pos);
        this.condition = conditionPart;
        if (posNew > 0) pos = posNew;

        [ match, posNew ] = scanFirst(step, pos, [ " :" ]);
        if (match === " :") {
            this.spec = step.substring(pos, posNew - 2).trim();
            this.rename = upTo(step, " ", posNew);
        } else {
            this.spec = step.substring(pos).trim();
        }
    }

    test(msg: Message, mode: PipelineMode, context: PipelineContext): boolean {
        return !(this.condition && !this.condition.satisfies(msg, mode, context));
    }

    execute(msg: Message, context: PipelineContext): Promise<Message | AsyncQueue<Message>> {
        const sendMsg = (msg: Message): Promise<Message> => {
            // send target headers if domain being sent to is targetHost
            if (context.targetHost && !msg.url.domain) {
                msg.url.domain = context.targetHost.domain;
                msg.url.scheme = context.targetHost.scheme;
            }
            if (context.targetHost && msg.url.domain === context.targetHost.domain) {
                Object.assign(msg.headers, context.targetHeaders);
            }

            //const externality = context.external ? Source.External : Source.Internal;
            
            return context.handler(msg);
        }

        const innerExecute = async () => {
            try {
                let outMsg = msg;
                if (this.spec) {
                    const newMsg_s = await msg.divertToSpec(this.spec, "POST", context.callerUrl, context.callerMethod, msg.headers);
                    if (Array.isArray(newMsg_s)) {
                        const newMsgs = new AsyncQueue<Message>(newMsg_s.length);
                        newMsg_s.forEach((msg, i) => sendMsg(msg).then(outMsg => {
                            if (this.rename) {
                                outMsg.name = resolvePathPatternWithUrl(this.rename, outMsg.url) as string;
                            } else {
                                outMsg.name = i.toString();
                            }
                            newMsgs.enqueue(outMsg);
                        }));
                        return newMsgs;
                    } else {
                        outMsg = await sendMsg(newMsg_s);
                    }
                }
                if (this.rename) {
                    outMsg.name = resolvePathPatternWithUrl(this.rename, outMsg.url) as string;
                }
                if (this.tryMode) {
                    outMsg.enterConditionalMode();
                }
                return outMsg;
            } catch (err) {
                config.logger.error(`error executing pipeline element: ${this.step}, ${err}`);
                return msg.setStatus(500, 'Internal Server Error');
            }
        }
        return innerExecute();
    }
}