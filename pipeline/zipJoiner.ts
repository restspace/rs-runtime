import { Message } from "rs-core/Message.ts";
import { write, WriteEntry } from "https://deno.land/x/streaming_zip@v1.0.1/write.ts";
import { crc32 } from "https://deno.land/x/crc32@v0.2.2/mod.ts";
import { addExtension, getType } from "rs-core/mimeType.ts";
import { last, upToLast } from "rs-core/utility/utility.ts";

async function* messageProcessor(firstMsg: IteratorResult<Message | null, Message | null>, msgs: AsyncIterator<Message, Message, Message>) {
	let msgResult = firstMsg;
	const dirPaths: string[] = [];
	
	while (!msgResult.done) {
		const msg = msgResult.value;
		if (msg && msg.data) {
			const buf = await msg.data.asArrayBuffer();
			const stream = msg.data.asReadable();
			if (buf && stream) {
				let name = msg.name;
				if (name.includes('/')) {
					const dirPath = upToLast(name, '/');
					if (!dirPaths.includes(dirPath)) {
						dirPaths.push(dirPath);
						const dirEntry: WriteEntry = {
							type: "directory",
							name: dirPath + '/'
						}
						yield dirEntry;
					}
				}
				name = name || msg.url.resourceName;
				const nameMime = getType(name);
				if (nameMime === null) {
					name = addExtension(name, msg.data.mimeType);
				}
				const entry: WriteEntry = {
					type: "file",
					name,
					body: {
						stream,
						originalSize: buf?.byteLength,
						originalCrc: parseInt(crc32(new Uint8Array(buf)), 16)
					}
				}
				yield entry;
			}
		}
		msgResult = await msgs.next();
	}
}

export async function zip(msgs: AsyncIterator<Message, Message, Message>, tenant: string): Promise<Message | null> {
    let first: IteratorResult<Message | null, Message | null> = { value: null, done: false };
    while (!((first.value && first.value.hasData()) || first.done)) {
        first = await msgs.next();
    }

	const stream = write(messageProcessor(first, msgs));
    const msgOut = first.value!;
	if (msgOut.name && msgOut.name.includes('.')) {
		msgOut.name = msgOut.name.split('.').slice(0, -1).join('.');
	}
    const filename = msgOut.url.isDirectory ? last(msgOut.url.pathElements) : msgOut.url.resourceName;
    // once you have first message, return the archiver which is an active stream as the data
    return msgOut.copy()
        .setData(stream, 'application/zip')
        .setHeader('Content-Disposition', 'attachment; filename="' + filename + '.zip"');
}