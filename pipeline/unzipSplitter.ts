import { Message } from "rs-core/Message.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";
import { read } from "../zip/read.ts";
import { getType } from "rs-core/mimeType.ts";

export function unzip(msg: Message): AsyncQueue<Message> {
    const queue = new AsyncQueue<Message>();
	if (!msg.data) return queue;
	const readable = msg.data.asReadable();
	if (!readable) return queue;
    (async () => {
		try {
			for await (const entry of read(readable)) {
				const newUrl = msg.url.copy();
				newUrl.servicePath = newUrl.servicePath + entry.name;
				if (entry.type === 'file')
				{
					const entryMsg = msg.copy()
						.setName(entry.name)
						.setData(entry.body.stream(), getType(entry.name) || '')
						.setUrl(newUrl)
						.removeHeader('transfer-encoding');
					queue.enqueue(entryMsg);
				}
			}
			queue.close();
		} catch (err) {
			queue.enqueue(err).close();
		}
	})();

    return queue;
}