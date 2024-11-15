import { Message } from "rs-core/Message.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";
import { ZipReader } from "https://deno.land/x/zipjs/index.js"
import { getType } from "rs-core/mimeType.ts";
import { pathCombine } from "rs-core/utility/utility.ts";

export function unzip(msg: Message): AsyncQueue<Message> {
    const queue = new AsyncQueue<Message>();
	if (!msg.data) return queue.enqueue(new Error('Unzipping with no data')).close();
	const readable = msg.data.asReadable();
	if (!readable) return queue.enqueue(new Error('Unzipping with no readable')).close();
	if (!msg.data.mimeType.includes('zip')) {
		return queue.enqueue(new Error('Unzipping with non-zip data')).close();
	}
    (async () => {
		try {
			const zipReader = new ZipReader(readable);
			const entries = await zipReader.getEntries();
			if (entries.length === 0) {
				queue.enqueue(msg.copy().setNullMessage(true)).close();
				return;
			} else {
				for (const entry of entries) {
					if (entry.directory) continue;
					const transformStream = new TransformStream();
					entry.getData?.(transformStream.writable);
					const newUrl = msg.url.copy();
					newUrl.servicePath = pathCombine(newUrl.servicePath, entry.filename);
					const entryMsg = msg.copy()
						.setName(entry.filename)
						.setData(entry.getData ? transformStream.readable : null, getType(entry.filename) || '')
						.setUrl(newUrl)
						.removeHeader('transfer-encoding');
					queue.enqueue(entryMsg);
				}
			}
			queue.close();
		} catch (err) {
			queue.enqueue(err as Error).close();
		}
	})();

    return queue;
}