import { Message } from "rs-core/Message.ts";
import { isJson } from "rs-core/mimeType.ts";
import { jsonQuote } from "rs-core/utility/utility.ts";

export async function jsonObject(msgs: AsyncIterator<Message, Message, Message>): Promise<Message | null> {
    let first: IteratorResult<Message | null, Message | null> = { value: null };
    while (!((first.value && first.value.hasData()) || first.done)) {
        first = await msgs.next();
    }
    if (first.done) return null; // no messages


    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const writeString = (data: string) => writer.write(new TextEncoder().encode(data));
    let length = -1;
    const writeProperty = (name: string, val: string) => {
        writeString(`  "${name}": `);
        writeString(val);
        if (length > -2 && /^\d+$/.test(name)) { // positive integer or zero
            const itemIdx = parseInt(name) + 1;
            if (itemIdx > length) length = itemIdx;
        } else if (name === 'length') {
            length = -2; // already has length property
        }
    };
    writeString("{\n");

    const writeMsg = async (msg: Message | null) => {
        if (!msg) return;
        if (msg.name === "$this") {
            // if the data is an object, merge its properties into the output
            if (!isJson(msg.data?.mimeType)) {
                writeString('  "data": ');
                writeString('"');
                writeString(await msg.data?.asString() || '');
                writeString('"');
            } else {
                const obj = await msg.data?.asJson();
                if (typeof obj !== 'object') {
                    writeProperty("data", JSON.stringify(obj));
                } else {
                    let first = true;
                    for (const prop in obj) {
                        if (first) {
                            first = false;
                        } else {
                            writeString(',\n');
                        }
                        writeProperty(prop, JSON.stringify(obj[prop]));
                    }
                }
            }
        } else {
            // append the first message's data to the JSON output
            const name = msg.name.replace('"', '');
            if (msg.data?.data === null) {
                writeProperty(name, "null");
                return;
            }
            if (isJson(msg.data?.mimeType)) {
                writeProperty(name, await msg.data?.asString() || '');
            } else {
                writeProperty(name, '"' + jsonQuote(await msg.data?.asString() || '') + '"');
            }
        }
    }

    await writeMsg(first.value);

    // fire and forget async adding other messages as they are available
    msgs.next().then(async (second) => {
        let res = second;
        while (!res.done) {
            if (res.value && res.value.hasData()) {
                writeString(",\n");
                await writeMsg(res.value);
            }
            const nextMsgPromise = msgs.next();
            res = await nextMsgPromise;
        }
        if (length >= 0) { // if has numeric property names, make an ArrayLike by adding a length
            writeString(",\n");
            writeProperty('length', length.toString());
        }
        writeString("\n}");
        writer.close();
    });

    return (first.value && first.value.setData(readable, 'application/json')) || null;
}