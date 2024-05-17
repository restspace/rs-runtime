import { Message } from "rs-core/Message.ts";
import { isJson } from "rs-core/mimeType.ts";
import { jsonQuote } from "rs-core/utility/utility.ts";

export async function jsonObject(msgs: AsyncIterator<Message, Message, Message>): Promise<Message | null> {
    let outerName = '';
    let first: IteratorResult<Message | null, Message | null> = { value: null };
    let nullMessage = null as Message | null;
    while (!((first.value && first.value.hasData()) || first.done)) {
        first = await msgs.next();
        if (first.value) nullMessage = first.value;
    }
    if (first.done) {
        if (!nullMessage) return null;
        return nullMessage.setNullMessage(false).setData("{}", "application/json");
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const writeString = async (data: string) => await writer.write(new TextEncoder().encode(data));
    let length = -1;
    const writeProperty = async (name: string, val: string) => {
        await writeString(`  "${name}": `);
        await writeString(val);
        if (length > -2 && /^\d+$/.test(name)) { // positive integer or zero
            const itemIdx = parseInt(name) + 1;
            if (itemIdx > length) length = itemIdx;
        } else if (name === 'length') {
            length = -2; // already has length property
        }
    };
    await writeString("{\n");

    const writeMsg = async (msg: Message | null) => {
        if (!msg) return;
        if (msg.name === "$this") {
            // if the data is an object, merge its properties into the output
            if (!isJson(msg.data?.mimeType)) {
                await writeString('  "data": ');
                await writeString('"');
                await writeString(await msg.data?.asString() || '');
                await writeString('"');
            } else {
                const obj = await msg.data?.asJson();
                if (typeof obj !== 'object') {
                    await writeProperty("data", JSON.stringify(obj));
                } else {
                    let first = true;
                    for (const prop in obj) {
                        if (first) {
                            first = false;
                        } else {
                            await writeString(',\n');
                        }
                        await writeProperty(prop, JSON.stringify(obj[prop]));
                    }
                }
            }
        } else {
            let name = msg.name.replace('"', '');
            if (name.includes('.')) {
                const lastDot = name.lastIndexOf('.');
                const newOuterName = name.substring(0, lastDot);
                if (newOuterName && !outerName) {
                    outerName = newOuterName;
                } else if (newOuterName !== outerName) {
                    outerName = "_mixed_";
                }
                name = name.substring(lastDot + 1);
            }
            if (msg.data?.data === null) {
                await writeProperty(name, "null");
                return;
            }
            if (isJson(msg.data?.mimeType)) {
                await writeProperty(name, await msg.data?.asString() || '');
            } else {
                await writeProperty(name, '"' + jsonQuote(await msg.data?.asString() || '') + '"');
            }
        }
    }

    await writeMsg(first.value);

    // fire and forget async adding other messages as they are available
    msgs.next().then(async (second) => {
        let res = second;
        while (!res.done) {
            if (res.value && res.value.hasData()) {
                await writeString(",\n");
                await writeMsg(res.value);
            }
            const nextMsgPromise = msgs.next();
            res = await nextMsgPromise;
        }
        if (length >= 0) { // if has numeric property names, make an ArrayLike by adding a length
            await writeString(",\n");
            await writeProperty('length', length.toString());
        }
        await writeString("\n}");
        await writer.close();
    });

    return (first.value && first.value.setData(readable, 'application/json').setName(outerName)) || null;
}