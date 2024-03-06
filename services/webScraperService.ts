import { IServiceConfig } from "https://lib.restspace.io/core/IServiceConfig.ts";
import { Message } from "https://lib.restspace.io/core/Message.ts";
import { Service } from "https://lib.restspace.io/core/Service.ts";
import { ServiceContext } from "https://lib.restspace.io/core/ServiceContext.ts";
import { Url } from "https://lib.restspace.io/core/Url.ts";
import { IProxyAdapter } from "https://lib.restspace.io/core/adapter/IProxyAdapter.ts";
import {
    DOMParser,
    Element,
    Node,
    initParser,
  } from "https://deno.land/x/deno_dom/deno-dom-wasm-noinit.ts";

/*
interface IWebScraperServiceConfig extends IServiceConfig {
// custom config here
}
*/

const service = new Service<IProxyAdapter, IServiceConfig>();

service.initializer(async () => {
    await initParser();
});

const scrapeFromSpec = async (spec: any, reqMsg: Message, subpath: string[], context: ServiceContext<IProxyAdapter>) => {
    const sendMsg = await context.adapter.buildMessage(reqMsg);
    const pageMsg = await context.makeRequest(sendMsg);
    if (!pageMsg.ok) return {
        $status: pageMsg.status,
        $message: (await pageMsg?.data?.asString()) || ''
    };
    if (!pageMsg.data) return { $status: 400, $message: `No data ${reqMsg.url}` };
    const page = await pageMsg.data.asString();
    if (!page) return { $status: 400, $message: `No page ${reqMsg.url}` };
    const doc = new DOMParser().parseFromString(page, "text/html");
    if (!doc) return { $status: 400, $message: `HMTL parse failed ${reqMsg.url}` };

    const returnVal: any = {};
    if (subpath.length === 0) {
        for (const key in spec) {
            if (key.startsWith('$')) continue;

            let value = spec[key];
            const returnArray = Array.isArray(value);

            if (returnArray) {
                if (value.length !== 1) {
                    returnVal[key] = { $status: 400, $message: `Array in spec must contain one template item` };
                    continue;
                }
                value = value[0];
            }

            if (typeof value === 'string') {
                returnVal[key] = returnArray
                    ? Array.from(doc.querySelectorAll(value)).map(el => el.textContent)
                    : doc.querySelector(value)?.textContent;
            } else if (Array.isArray(value)) {
                returnVal[key] = { $status: 400, $message: `Directly nested arrays not allowed in spec` };
            } else if (value && typeof value === 'object') {
                if (!value['$urlselector']) {
                    returnVal[key] = { $status: 400, $message: `No url selector specified in subspec at ${key}` };
                    continue;
                }
                const elsArray = returnArray
                    ? Array.from(doc.querySelectorAll(value['$urlselector']))
                        .filter(node => node.nodeType === Node.ELEMENT_NODE)
                    : [ doc.querySelector(value['$urlselector']) ];
                const els = elsArray.filter(el => !!el) as Element[];
                const retValues = [];
                for (const el of els)
                {
                    const href = el.getAttribute('href');
                    if (!href) {
                        retValues.push({ $status: 400, $message: `No href found at ${value['$urlselector']}` });
                        continue;
                    }
                    let nextUrl = new Url(href);
                    if (nextUrl.isRelative) { // relative
                        nextUrl = reqMsg.url.follow(href);
                    } else if (href.startsWith('/')) { // site-relative
                        nextUrl = reqMsg.url.copy();
                        nextUrl.path = href;
                    }
                    const subReqMsg = new Message(nextUrl, context, 'GET', reqMsg);
                    const subReqVal: any = await scrapeFromSpec(value, subReqMsg, subpath, context);
                    if (subReqVal.$status && subReqVal.$message) return subReqVal;
                    retValues.push(subReqVal);                       
                };
                returnVal[key] = returnArray ? retValues : retValues[0];
            }
        }
    }
    return returnVal;
}

service.post(async (msg, context) => {
    const reqSpec = msg.copy().setMethod("GET");
	const msgSpec = await context.makeRequest(reqSpec);
	if (!msgSpec.ok) return msgSpec;
    if (msgSpec?.data?.mimeType !== 'application/json') return msg.setStatus(400, 'Spec is not JSON');
	let spec = await msgSpec.data!.asJson();
	if (!spec) return msg.setStatus(400, 'No spec');
    if (!spec['$url']) return msg.setStatus(400, 'No url in spec');

    // find the applicable url: the msgSpec location header tells you the url of the actual spec file
	// - the rest is the subpath of the url
	const contextUrl: Url = msg.url.copy();
	contextUrl.setSubpathFromUrl(msgSpec.getHeader('location') || '');

    const reqMsg = new Message(spec['$url'], context, 'GET', msg);
    const scrape = await scrapeFromSpec(spec, reqMsg, contextUrl.subPathElements, context);
    if (scrape.$status && scrape.$message) return msg.setStatus(scrape.$status, scrape.$message);
    msg.setDataJson(scrape);
    return msg;
});

export default service;