import { Service } from "rs-core/Service.ts";
import { encode, decode } from "std/encoding/base64.ts"
import { Url } from "rs-core/Url.ts";
import { QuotaQueueConfig, QuotaQueueState } from "rs-core/state/QuotaQueueState.ts";

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
    return msg.setData(encode(arry), "text/plain");
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
    context.logger.info('BODY ' + JSON.stringify(json || {}));
    return msg;
});
service.postPath('/log/headers', (msg, context) => {
    context.logger.info('HEADERS ' + JSON.stringify(msg.headers));
    return msg;
});
service.postPath('/set-browser-headers', msg => {
    Object.entries(msg.headers).forEach(([key]) => {
        if (![ 'content-type', 'content-length', 'content-disposition' ].includes(key)) {
            msg.removeHeader(key);
        }
    });
    msg.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    msg.setHeader('Accept-Language', 'en-US,en;q=0.9');
    msg.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9');
    msg.setHeader('Referer', 'https://www.google.com/');
    return msg;
} )
service.postPath('/set-name', msg => {
    if (msg.data) {
        msg.name = msg.url.query['$name'][0] || msg.name;
    }
    return msg;
});
service.postPath('/quota-delay', async (msg, context, config) => {
    if (!msg.url.servicePathElements[0]) {
        return Promise.resolve(msg.setStatus(400, 'missing path element 1, uid'));
    }
    const uid = msg.url.servicePathElements[0];

    if (!msg.url.servicePathElements[1] 
        || !['per-second', 'per-minute'].includes(msg.url.servicePathElements[1])) {
        return Promise.resolve(msg.setStatus(400, 'missing or bad path element 2, time unit (per-second or per-minute)'));
    }
    const timeUnit = msg.url.servicePathElements[1];

    if (!msg.url.servicePathElements[2]) {
        return Promise.resolve(msg.setStatus(400, 'missing path element 3, requests per time unit'));
    }
    const reqPerTimeUnit = parseInt(msg.url.servicePathElements[2]);
    if (isNaN(reqPerTimeUnit)) {
        return Promise.resolve(msg.setStatus(400, 'bad path element 3, requests per time unit'));
    }

    const delayerParams = {} as QuotaQueueConfig;
    if (timeUnit === 'per-second') {
        delayerParams.reqSec = reqPerTimeUnit;
    } else {
        delayerParams.reqMin = reqPerTimeUnit;
    }

    const delayer = await context.state(QuotaQueueState, context, config);
    delayer.ensureDelayer(uid, delayerParams);

    await delayer.wait(uid);
    
    return msg;
});

export default service;
