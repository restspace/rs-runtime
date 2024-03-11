import { Service } from "rs-core/Service.ts";
import { encode, decode } from "std/encoding/base64.ts"
import { Url } from "rs-core/Url.ts";

const service = new Service();

service.postPath('/bypass', msg => msg);

service.postPath('/devnull', msg => msg.setData(null, "text/plain"));

service.postPath('/destream', async msg => {
    await msg.data?.ensureDataIsArrayBuffer();
    return msg;
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
service.postPath('/redirect-permanent', msg => {
    const location = '/' + msg.url.servicePath;
    msg.exitConditionalMode();
    return msg.setHeader('location', location).setStatus(301);
});
service.postPath('/redirect-temporary', msg => {
    const location = '/' + msg.url.servicePath;
    msg.exitConditionalMode();
    return msg.setHeader('location', location).setStatus(307);
});
service.postPath('/see-other', msg => {
    const location = '/' + msg.url.servicePath;
    msg.exitConditionalMode();
    return msg.setHeader('location', location).setStatus(303);
});
service.postPath('/reload-referer', msg => {
    const location = msg.getHeader('referer');
    if (!location) return Promise.resolve(msg);
    msg.exitConditionalMode();
    return msg.setHeader('location', location).setStatus(303);
});
service.postPath('/log/body', async (msg, context) => {
    const json = await msg.data?.asJson();
    context.logger.info('BODY ' + JSON.stringify(json || {}), ...msg.loggerArgs());
    return msg;
});

export default service;
