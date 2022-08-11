import { Service } from "rs-core/Service.ts";
import { encode, decode } from "std/encoding/base64.ts"

const service = new Service();

service.postPath('/bypass', msg => {
    return Promise.resolve(msg);
});
service.postPath('/to-b64', async msg => {
    if (!msg.data) return msg;
    const arry = new Uint8Array((await msg.data.asArrayBuffer())!);
    return msg.setData(encode(arry), msg.data.mimeType);
});
service.postPath('/from-b64', async msg => {
    if (!msg.data) return msg;
    const str = new TextDecoder().decode((await msg.data.asArrayBuffer())!);
    return msg.setData(decode(str).buffer, msg.data.mimeType);
});

export default service;
