import { Message } from "rs-core/Message.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";

export function jsonSplit(msg: Message): AsyncQueue<Message> {
    const queue = new AsyncQueue<Message>();
	if (!msg.data) return queue;
	msg.data.asJson().then(obj => {
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => queue.enqueue(msg.copy().setName(i.toString()).setDataJson(item)));
        } else if (typeof obj === 'object') {
            Object.entries(obj).forEach(([key, value]) => queue.enqueue(msg.copy().setName(key).setDataJson(value)));
        } else {
            queue.enqueue(msg);
        }
        queue.close();
    });
    return queue;
}