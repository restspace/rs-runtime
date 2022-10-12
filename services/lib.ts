import { Service } from "rs-core/Service.ts";
import { encode, decode } from "std/encoding/base64.ts"
import { Url } from "rs-core/Url.ts";

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
service.postPath('/selector-schema', async msg => {
    if (!msg.data) return msg;
    if (msg.data.mimeType !== 'inode/directory+json') {
        return Promise.resolve(msg.setStatus(400,
            'selector-schema only applies to a directory output (mime type inode/directory+json)'));
    }
    const dirJson = await msg.data.asJson() as string[];
    const items = dirJson.filter(i => !i.endsWith('/'));
    const schema = {
        type: "string",
        enum: items
    };
    return msg.setDataJson(schema, "application/schema+json");
});
service.postPath('/redirect-on-unauthorized', msg => {
    if (msg.status === 401 || msg.status === 403) {
        const redirectUrl = new Url('/' + msg.url.servicePathElements.slice(1).join('/'));
        redirectUrl.query.originalUrl = [ msg.url.toString() ];

        msg.redirect(redirectUrl, true);
    }
    return Promise.resolve(msg);
});

export default service;
