import { Service } from "rs-core/Service.ts";
import { encode, decode } from "std/encoding/base64.ts"
import { Url } from "rs-core/Url.ts";
import { QuotaQueueConfig, QuotaQueueState } from "rs-core/state/QuotaQueueState.ts";
import { isJson, isText } from "rs-core/mimeType.ts";
import { getUserFromEmail } from "rs-core/user/userManagement.ts";
import { config } from "../config.ts";
import { userIsAnon } from "rs-core/user/IAuthUser.ts";

const service = new Service();

service.postPath('/bypass', msg => msg);

service.postPath('/devnull', msg => msg.setData(null, "text/plain"));

service.postPath('/destream', async msg => {
    await msg.data?.ensureDataIsArrayBuffer();
    return msg;
});

service.postPath('/to-text', async msg => {
    if (!msg.data) return msg;
    if (isJson(msg.data.mimeType)) {
        const json = await msg.data.asJson();
        return msg.setData(typeof json === 'string' ? json : JSON.stringify(json), "text/plain");
    }
    if (!isText(msg.data.mimeType)) {
        const arry = await msg.data.asArrayBuffer();
        if (!arry) return msg;
        return msg.setData(encode(arry), "text/plain");
    }
    return msg;
});

service.postPath('/to-b64', async msg => {
    if (!msg.data) return msg;
    const arry = await msg.data.asArrayBuffer();
    if (!arry) return msg;
    return msg.setData(encode(arry), "text/plain");
});
service.postPath('/from-b64', async msg => {
    if (!msg.data) return msg;
    const str = new TextDecoder().decode((await msg.data.asArrayBuffer())!);
    const buffer = decode(str);
    const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : buffer.buffer as ArrayBuffer;
    return msg.setData(arrayBuffer, msg.data.mimeType);
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
service.postPath('/delocalise-store-location', msg => {
    const location = msg.getHeader('location');
    if (!location) return Promise.resolve(msg);
    const url = new Url(location);
    url.servicePathElements = url.servicePathElements.filter(e => !e.startsWith('*'))
    return msg.setHeader('location', url.toString());
});
service.postPath('/log/body', async (msg, context) => {
    const str = await msg.data?.asString();
    context.logger.info('BODY ' + str?.substring(0, 1000));
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

service.postPath('/check-user-field', async (msg, context) => {
    if (!msg.user || userIsAnon(msg.user)) {
        return msg.setStatus(400, 'No authenticated user');
    }
    
    if (!msg.url.servicePathElements[0]) {
        return msg.setStatus(400, 'missing path element 1, user record property');
    }
    const userProperty = msg.url.servicePathElements[0];
    
    if (!msg.url.servicePathElements[1]) {
        return msg.setStatus(400, 'missing path element 2, check value');
    }
    const checkValue = msg.url.servicePathElements[1];
    
    const tenant = config.tenants[context.tenant];
    if (!tenant || !tenant.authServiceConfig) {
        return msg.setStatus(400, 'Auth service not configured');
    }
    
    const authServiceConfig = tenant.authServiceConfig as { userUrlPattern?: string };
    if (!authServiceConfig.userUrlPattern) {
        return msg.setStatus(400, 'userUrlPattern not configured');
    }
    
    const userRecord = await getUserFromEmail(context, authServiceConfig.userUrlPattern, msg, msg.user.email);
    if (!userRecord) {
        return msg.setStatus(400, 'User record not found');
    }
    
    const userValue = (userRecord as Record<string, unknown>)[userProperty];
    if (userValue === undefined) {
        return msg.setStatus(400, `User record property '${userProperty}' not found`);
    }
    
    if (String(userValue) !== checkValue) {
        return msg.setStatus(400, `User record property '${userProperty}' does not match check value`);
    }
    
    return msg.setStatus(0);
});

export default service;
