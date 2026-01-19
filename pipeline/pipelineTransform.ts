import { Message } from "rs-core/Message.ts";
import { transformation } from "rs-core/transformation/transformation.ts";
import { PipelineContext } from "./pipelineContext.ts";

export class PipelineTransform {

    constructor(public transform: object) {}

    async execute(msg: Message, context: PipelineContext): Promise<Message> {
        const jsonIn = msg.data ? await msg.data.asJson() : {};
        let transJson: any = null;
        try {
            // Expose message details as transform variables, while preserving the shared pipeline VariableScope.
            // Do not overwrite existing values (e.g. when a pipeline explicitly sets $_user via :$_user).
            const scope = context.variables.getScope(msg.name);
            if (scope.get('$_headers') === undefined) {
                context.variables.setForScope(msg.name, '$_headers', msg.headers);
            }
            if (scope.get('$_user') === undefined) {
                context.variables.setForScope(msg.name, '$_user', msg.user);
            }
            const variableScope = context.variables.getScope(msg.name);
            transJson = transformation(this.transform, jsonIn, context.callerUrl || msg.url, msg.name, variableScope);
        } catch (err) {
            if (err instanceof SyntaxError) {
                const errx = err as SyntaxError & { filename: string };
                return msg.setStatus(400, `${errx.message} at: ${errx.filename} cause: ${errx.cause}`);
            }
        }
        if (context.trace) {
            context.traceOutputs![context.path.join('.')] = transJson;
        }
        return msg.copy().setDataJson(transJson);
    }

    static isValid(item: any): boolean {
        return item && typeof item === 'object';
    }
}