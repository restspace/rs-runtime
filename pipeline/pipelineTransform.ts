import { Message } from "rs-core/Message.ts";
import { transformation } from "../../rs-core/transformation/transformation.ts";
import { PipelineContext } from "./pipelineContext.ts";

export class PipelineTransform {

    constructor(public transform: object) {}

    async execute(msg: Message, context: PipelineContext): Promise<Message> {
        const jsonIn = msg.data ? await msg.data.asJson() : {};
        const transJson = transformation(this.transform, jsonIn, context.callerUrl || msg.url);
        return msg.setDataJson(transJson);
    }

    static isValid(item: any): boolean {
        return typeof item === 'object';
    }
}