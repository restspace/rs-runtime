import { Url } from "rs-core/Url.ts";
import { limitConcurrency } from "rs-core/utility/limitConcurrency.ts";
import { PipelineContext } from "./pipelineContext.ts";

export function pipelineInitializerIntoContext(step: string): Partial<PipelineContext> | null {
    const words = step.split(' ').map(word => word.trim());
    switch (words[0]) {
        case "targetHost": {
            if (words.length < 2) return null;
            let host = words[1];
            if (!(host.startsWith("http") && host.includes("//"))) host = "http://" + host;
            if (!Url.urlRegex.test(host)) return null;
            const targetHost = new Url(host);
            return { targetHost };
        }
        case "trace": {
            return { trace: true, traceOutputs: {} };
        }
        case "concurrency": {
            if (words.length < 2) return null;
            const limit = parseInt(words[1]);
            if (isNaN(limit)) return null;
            return { concurrencyLimiter: limitConcurrency(limit) };
        }
        default: {
            return null;
        }
    }
}