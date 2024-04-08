import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import {
    DOMParser,
    Element,
    HTMLDocument,
    Node,
    initParser,
  } from "https://deno.land/x/deno_dom/deno-dom-wasm-noinit.ts";
  import { jsonPath } from "rs-core/jsonPath.ts";
  import { upTo } from "rs-core/utility/utility.ts";
  import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";
  import { Url } from "rs-core/Url.ts";
  import { BaseStateClass } from "rs-core/ServiceContext.ts";
  import { Delayer, ensureDelay } from "rs-core/utility/ensureDelay.ts";

interface IWebScraperServiceConfig extends IServiceConfig {
    minDelayMs?: number;
    randomOffsetMs?: number;
}

class WebScraperState extends BaseStateClass {
    minDelayMs = 1000;
    randomOffsetMs = 200;
    delayers: Record<string, Delayer> = {};

    async load(_context: ServiceContext<IProxyAdapter>, config: IWebScraperServiceConfig) {
        this.minDelayMs = config.minDelayMs || 1000;
        this.randomOffsetMs = config.randomOffsetMs || 200;
    }

    getDelayer(domain: string) {
        if (!(domain in this.delayers)) {
            this.delayers[domain] = ensureDelay(this.minDelayMs, this.randomOffsetMs);
        }
        return this.delayers[domain];
    }
}

const service = new Service<IProxyAdapter, IWebScraperServiceConfig>();

service.initializer(async (context, config) => {
    await initParser();
    await context.state(WebScraperState, context, config);
});

const nodeAttribute = (node: Node | Element | null | undefined, attribute: string): string | null => {
    if (!node) return null;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (attribute in node) return (node as Record<string, any>)[attribute]?.toString();
    return (node as Element).getAttribute(attribute);
}

const parseSpec = (spec: string): [spec: string, attribute: string] => {
    let attribute = "textContent";
    const match = spec.match(/ @([-_a-zA-Z0-9]+)$/);
    if (match) {
        attribute = match[1];
        spec = spec.slice(0, -match[0].length);
    }
    return [spec, attribute];
}

const scrapeFromSpec = async (spec: any, reqMsg: Message, subpath: string[], context: ServiceContext<IProxyAdapter>, delayer: Delayer) => {
    const sendMsg = await context.adapter.buildMessage(reqMsg);
    const pageMsg = await delayer(() => context.makeRequest(sendMsg));
    if (!pageMsg.ok) return {
        $status: pageMsg.status,
        $message: (await pageMsg?.data?.asString()) || ''
    };
    if (!pageMsg.data) return { $status: 400, $message: `No data ${reqMsg.url}` };
    const page = await pageMsg.data.asString();
    if (!page) return { $status: 400, $message: `No page ${reqMsg.url}` };
    return extractFromPage(spec, page, upTo(pageMsg.data.mimeType, ';'), reqMsg, context, subpath, delayer);
}

const extractFromPage = async (spec: any, page: string, mimeType: string, reqMsg: Message, context: ServiceContext<IProxyAdapter>, subpath: string[], delayer: Delayer) => {
    let doc = null as HTMLDocument | null;
    let obj = null as any;
    let itemGetter = (spec: string) => "" as string | null;
    let arrayGetter = (spec: string) => ["" as string | null];

    try {
        switch (upTo(mimeType, ';')) {
            case 'text/html':
                doc = new DOMParser().parseFromString(page, "text/html");
                if (doc === null) return { $status: 400, $message: `HMTL parse failed ${location}` };
                itemGetter = spec => {
                    let attribute: string;
                    [spec, attribute] = parseSpec(spec);
                    return nodeAttribute(doc!.querySelector(spec), attribute)?.trim() || null;
                }
                arrayGetter = spec => {
                    let attribute: string;
                    [spec, attribute] = parseSpec(spec);
                    return Array.from(doc!.querySelectorAll(spec)).map(
                        el => nodeAttribute(el, attribute)?.trim() || null
                    );
                }
                break;
            case 'application/json':
                obj = JSON.parse(page);
                itemGetter = spec => jsonPath(obj, spec);
                arrayGetter = spec => jsonPath(obj, spec);
                break;
            default:
                return { $status: 400, $message: `Unsupported mime type ${mimeType}` };
        }
    } catch (e) {
        return { $status: 400, $message: `Error parsing ${location}: ${e}` };
    }

    const returnVal: any = {};
    for (const key in spec) {
        if (key.startsWith('$')) continue;

        let value = spec[key];
        const returnsArray = Array.isArray(value);

        if (returnsArray) {
            if (value.length !== 1) {
                returnVal[key] = { $status: 400, $message: `Array in spec must contain one template item` };
                continue;
            }
            value = value[0];
        }

        if (typeof value === 'string') {
            returnVal[key] = returnsArray ? arrayGetter(value) : itemGetter(value);
        } else if (Array.isArray(value)) {
            returnVal[key] = { $status: 400, $message: `Directly nested arrays not allowed in spec` };
            continue;
        } else if (value && typeof value === 'object') {
            let hrefs: string[];
            let fetchMimeType = mimeType;
            if ('$mimeType' in value) {
                fetchMimeType = value['$mimeType'];
            }

            if ('$urlSelector' in value) {
                const hrefsOrNull = returnsArray
                ? arrayGetter(value['$urlSelector'] + " @href")
                : [ itemGetter(value['$urlSelector'] + " @href") ];
                hrefs = hrefsOrNull.filter(href => !!href) as string[];
            } else if ('$pagedUrlPattern' in value) {
                let pageCount = 1;
                if (value['$pageCountSelector']) {
                    pageCount = parseInt(
                        itemGetter(value['$pageCountSelector']) || "1"
                    );
                    if (isNaN(pageCount) || pageCount < 1) {
                        returnVal[key] = { $status: 400, $message: `Invalid page count ${value['$pageCountSelector']}` };
                        continue;
                    }
                }
                let pageLength = 1;
                if (value['$pageLengthSelector']) {
                    pageLength = parseInt(
                        itemGetter(value['$pageLengthSelector']) || "1"
                    );
                    if (isNaN(pageLength) || pageLength < 1) {
                        returnVal[key] = { $status: 400, $message: `Invalid page length ${value['$pageLengthSelector']}` };
                        continue;
                    }
                }
                let itemCount = 0;
                if (value['$itemCountSelector']) {
                    itemCount = parseInt(
                        itemGetter(value['$itemCountSelector']) || "0"
                    );
                    if (isNaN(itemCount) || itemCount < 0) {
                        returnVal[key] = { $status: 400, $message: `Invalid item count ${value['$itemCountSelector']}` };
                        continue;
                    }
                }
                if (itemCount > 0) pageCount = Math.floor(itemCount / pageLength);
                hrefs = [];
                if (!returnsArray) pageCount = 1;
                for (let i = 0; i < pageCount; i++) {
                    const pattern = value['$pagedUrlPattern'];
                    const url = resolvePathPatternWithUrl(pattern, reqMsg.url, {
                        page0: i.toString(),
                        page1: (i + 1).toString(),
                        take: pageLength.toString(),
                        skip: (i * pageLength).toString()
                    });
                    hrefs.push(url as string);
                }
            } else if ('$embeddedDataSelector' in value) {
                if (returnsArray) {
                    const data = arrayGetter(value['$embeddedDataSelector']);
                    const val = data
                        .filter(item => item !== null)
                        .map(item =>
                            extractFromPage(value, item!, fetchMimeType, reqMsg, context, subpath, delayer)
                        );
                    returnVal[key] = val;
                } else {
                    const data = itemGetter(value['$embeddedDataSelector']);
                    if (data) {
                        const val = await extractFromPage(value, data, fetchMimeType, reqMsg, context, subpath, delayer);
                        returnVal[key] = val;
                    } else {
                        returnVal[key] = { $status: 400, $message: `No data found at ${value['$embeddedDataSelector']}` };
                    }
                }
                continue;
            } else {
                returnVal[key] = { $status: 400, $message: `No url selector specified in subspec at ${key}` };
                continue;
            }

            const retValues = [];
            for (const href of hrefs)
            {
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
                if (fetchMimeType.startsWith('application/json')) {
                    subReqMsg.setHeader('accept', 'application/json, text/javascript, */*; q=0.01');
                    subReqMsg.setHeader('X-Requested-With', 'XMLHttpRequest');
                }
                const subReqVal: any = await scrapeFromSpec(value, subReqMsg, subpath, context, delayer);
                if (subReqVal.$status && subReqVal.$message) return subReqVal;
                retValues.push(subReqVal);                       
            };
            returnVal[key] = returnsArray ? retValues : retValues[0];
        }
    }
    return returnVal;
}

service.post(async (msg, context, config) => {
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

    const url = new Url(spec['$url']);
    if (!url.domain) return msg.setStatus(400, 'No domain in top level $url: ' + spec['$url']);    
    const reqMsg = new Message(url, context, 'GET', msg);
    const state = await context.state(WebScraperState, context, config);
    const delayer = state.getDelayer(url.domain);
    const scrape = await scrapeFromSpec(spec, reqMsg, contextUrl.subPathElements, context, delayer);
    if (scrape.$status && scrape.$message) return msg.setStatus(scrape.$status, scrape.$message);
    msg.setDataJson(scrape);
    return msg;
});

export default service;
