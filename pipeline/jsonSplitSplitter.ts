import { Message } from "rs-core/Message.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";
import { toLines } from "rs-core/streams/streams.ts";

export function jsonSplit(msg: Message): AsyncQueue<Message> {
    const queue = new AsyncQueue<Message>();
	if (!msg.data) return queue;
    // support newline-delimited JSON for streaming data
    if (msg.getHeader('content-type') === 'application/x-ndjson') {
        const rbl = msg.data.asReadable();
        if (!rbl) return queue;
        const processLines = async (rbl: ReadableStream<any>) => {
            let idx = 0;
            for await (const line of toLines(rbl)) {
                queue.enqueue(msg.copy().setName(idx.toString()).setData(line, "application/json"));
                idx++;
            }
            if (idx === 0) {
                // if there are zero split messages, ensure we have a null message to traverse the pipeline until the next join
                queue.enqueue(msg.copy().setNullMessage(true));
            }
            queue.close();
        }
        processLines(rbl);
    } else {
        msg.data.asJson().then(obj => {
            if (Array.isArray(obj)) {
                if (obj.length === 0) {
                    queue.enqueue(msg.copy().setNullMessage(true));
                } else {
                    obj.forEach((item, i) => queue.enqueue(msg.copy().setName(i.toString()).setDataJson(item)));
                }
            } else if (obj && typeof obj === 'object') {
                if (Object.keys(obj).length === 0) {
                    msg.nullMessage = true;
                    queue.enqueue(msg.copy().setNullMessage(true));
                } else {
                    Object.entries(obj).forEach(([key, value]) => queue.enqueue(msg.copy().setName(key).setDataJson(value)));
                }
            } else {
                queue.enqueue(msg);
            }
            queue.close();
        });
    }
    return queue;
}