import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import {
    DOMParser,
    Element,
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

// looks like { "items": { "index": 3, "subitems": { "index": 9 } } }
type LoopPosition = Record<string, any> & { index: number };

const positionAtPath = (loopPosition: LoopPosition, path: string[]) => {
    let current = loopPosition;
    for (const p of path) {
        if (!(p in current)) return undefined;
        current = current[p];
    }
    return current;
}

const incrementLoopPosition = (loopPosition: LoopPosition, path: string[]) => {
    let current = loopPosition;
    for (const p of path) {
        if (!(p in current)) current[p] = { index: -1 };
        current = current[p];
    }
    current.index++;
    Object.keys(current).filter(k => k !== 'index').forEach(k => delete current[k]);
}

const setIndexAtLoopPosition = (loopPosition: LoopPosition, path: string[], index?: number) => {
    let current = loopPosition;
    for (const p of path) {
        if (!(p in current)) current[p] = { index: 0 };
        current = current[p];
    }
    if (current.index !== index) {
        current.index = index ? index : -1;
        Object.keys(current).filter(k => k !== 'index').forEach(k => delete current[k]);
    }
}

interface IFetchContext {
    maxFetches?: number;
    delayer: Delayer;
    serviceContext: ServiceContext<IProxyAdapter>;
    loopPath: string[] | undefined;
    outputWriter?: WritableStreamDefaultWriter<any>;
    startFrom?: LoopPosition;
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

const parseSpec = (spec: string): [spec: string, attribute: string, filter: (s: string) => string] => {
    let attribute = "textContent";
    let [baseSpec, filterSpec] = spec.split('|').map(s => s.trim());
    const match = baseSpec.match(/ @([-_a-zA-Z0-9]+)$/);
    if (match) {
        attribute = match[1];
        baseSpec = baseSpec.slice(0, -match[0].length);
    }
    let filter = (s: string) => s;
    if (filterSpec) {
        if (filterSpec.startsWith('regex:')) {
            const regex = new RegExp(filterSpec.slice(6));
            filter = s => {
                const match = s.match(regex);
                return match ? match[1] : '';
            }
        } else if (filterSpec.startsWith('url:')) {
            const pattern = filterSpec.slice(4);
            filter = s => {
                let url: Url | null = null;
                try { url = new Url(s); } catch { return ''; }
                const newUrlStr = resolvePathPatternWithUrl(pattern, url) as string;
                return newUrlStr;
            };
        } else if (filterSpec === 'trim') {
            filter = s => s.trim();
        } else if (filterSpec === 'lowercase') {
            filter = s => s.toLowerCase();
        } else if (filterSpec === 'uppercase') {
            filter = s => s.toUpperCase();
        } else {
            throw new Error(`Unsupported filter ${filterSpec}`);
        }
    }
    return [baseSpec, attribute, filter];
}

const insertProperty = (spec: string, property: string) => {
    const parts = spec.split('|');
    const specParts = parts[0].split('@');
    if (specParts.length > 1) {
        specParts[specParts.length - 1] = property;
    } else {
        specParts[specParts.length - 1] += ' ';
        specParts.push(property);
    }
    parts[0] = specParts.join('@');
    return parts.join('|');
}

interface IGetters {
    itemGetter: (spec: string, idx?: number) => string | null;
    arrayGetter: (spec: string) => (string | null)[];
};

const makeGetters = (page: string, mimeType: string): IGetters => {
    let itemGetter: (spec: string, idx?: number) => string | null;
    let arrayGetter: (spec: string) => (string | null)[];

    switch (upTo(mimeType, ';')) {
        case 'text/html': {
            const doc = new DOMParser().parseFromString(page, "text/html");
            if (doc === null) throw new Error(`HMTL parse failed`);
            arrayGetter = spec => {
                let attribute: string;
                let filter: (s: string) => string;
                [spec, attribute, filter] = parseSpec(spec);
                return Array.from(doc!.querySelectorAll(spec)).map(
                    el => {
                        const res = nodeAttribute(el, attribute)?.trim() || null;
                        return res === null ? null : filter(res);
                    }
                );
            };
            itemGetter = (spec, idx) => {
                if (idx) return arrayGetter(spec)[idx];
                let attribute: string;
                let filter: (s: string) => string;
                [spec, attribute, filter] = parseSpec(spec);
                const res = nodeAttribute(doc!.querySelector(spec), attribute)?.trim() || null;
                return res === null ? null : filter(res);
            };
            return { itemGetter, arrayGetter };
        }
        case 'application/json': {
            const obj = JSON.parse(page);
            itemGetter = (spec, idx) => idx ? jsonPath(obj, spec)?.[idx] : jsonPath(obj, spec);
            arrayGetter = spec => jsonPath(obj, spec);
            return { itemGetter, arrayGetter };
        }
        default:
            throw new Error(`Unsupported mime type ${mimeType}`);
    }
}

const scrapeFromSpec = async (spec: any, path: string[], parentResult: Record<string, unknown>, loopPosition: LoopPosition, reqMsg: Message, fetchContext: IFetchContext) => {
    const sendMsg = await fetchContext.serviceContext.adapter.buildMessage(reqMsg);
    const pageMsg = await fetchContext.delayer(() => fetchContext.serviceContext.makeRequest(sendMsg));
    if (!pageMsg.ok) return {
        $status: pageMsg.status,
        $message: (await pageMsg?.data?.asString())?.substring(0, 500) || ''
    };
    if (!pageMsg.data) return { $status: 400, $message: `No data ${reqMsg.url}`, $loopPosition: loopPosition};
    const page = await pageMsg.data.asString();
    if (!page) return { $status: 400, $message: `No page ${reqMsg.url}`, $loopPosition: loopPosition };
    return extractFromPage(spec, path, parentResult, loopPosition, page, upTo(pageMsg.data.mimeType, ';'), reqMsg, fetchContext);
}

const extractFromPage = async (spec: any, path: string[], parentResult: Record<string, unknown>, loopPosition: LoopPosition, page: string, mimeType: string, reqMsg: Message, fetchContext: IFetchContext) => {
    let getters: IGetters;
    const errorOutput = (message: string) => ({ $status: 400, $message: message, $loopPosition: loopPosition });

    try {
        getters = makeGetters(page, mimeType);
    } catch (e) {
        return { $status: 400, $message: `Error parsing ${path.join('.')}: ${e}` };
    }

    const { itemGetter, arrayGetter } = getters;

    const returnVal: any = {};
    const startFrom = fetchContext.startFrom || {} as LoopPosition;
    const startFromAtPath = positionAtPath(startFrom, path);
    // if we're haven't yet reached the startFrom path
    let keyMatched = !!(startFromAtPath) || Object.keys(startFrom).length === 0;
    let keys = Object.keys(spec);

    const nextLoopKey = fetchContext.loopPath?.[path.length];
    // push processing of properties on the loop path to the end so we have
    // the other properties fully processed
    if (nextLoopKey && path.every((p, i) => p === fetchContext.loopPath![i])) {
        if (keys.includes(nextLoopKey)) {
            keys = keys.filter(k => k !== nextLoopKey).concat([ nextLoopKey ]);
        }
    }

    for (const key of keys) {
        if (key.startsWith('$')) continue;

        let value = spec[key];
        const newPath = [...path, key];
        const returnsArray = Array.isArray(value);

        // return empty arrays until startFrom key is found
        if (startFromAtPath && key in startFromAtPath) keyMatched = true;
        if (!keyMatched && returnsArray) {
            returnVal[key] = []
            continue;
        }
        const isLoopKey = fetchContext.loopPath && key === nextLoopKey && path.length === fetchContext.loopPath!.length - 1;
        const startFromAtKey = startFromAtPath?.[key];

        if (returnsArray) {
            if (value.length !== 1) {
                returnVal[key] = errorOutput(`Array in spec must contain one template item`);
                continue;
            }
            value = value[0];
        }

        // if the value is a string, this is a selector to extract data from the page
        if (typeof value === 'string') {
            if (value === '$url') {
                returnVal[key] = reqMsg.url.toString();
            } else if (value === '$loopPosition') {
                returnVal[key] = loopPosition;
            } else {
                returnVal[key] = returnsArray ? arrayGetter(value) : itemGetter(value);
            }
        // The value should not be an array as we've already checked for that
        } else if (Array.isArray(value)) {
            returnVal[key] = errorOutput(`Directly nested arrays not allowed in spec`);
            continue;
        // If the value is an object, this means we move to another page (or context within this one)
        } else if (value && typeof value === 'object') {
            let hrefs: string[];
            let fetchMimeType = mimeType;
            if ('$mimeType' in value) {
                fetchMimeType = value['$mimeType'];
            }
            const idx = value['$index'] as number | undefined;
            if (typeof idx !== 'number' && typeof idx !== 'undefined') {
                returnVal[key] = errorOutput(`Invalid index ${idx}`);
                continue;
            }

            // We move to a page by following a link
            if ('$urlSelector' in value) {
                hrefs = [];
                if (fetchContext.maxFetches === undefined || fetchContext.maxFetches > 0) {
                    const hrefsOrNull = returnsArray
                        ? arrayGetter(insertProperty(value['$urlSelector'], "href"))
                        : [ itemGetter(insertProperty(value['$urlSelector'], "href"), idx) ];
                    const hrefsSet = new Set<string>(); // faster than array.includes
                    hrefsOrNull.forEach(href => {
                        if (href && !hrefsSet.has(href)) {
                            hrefsSet.add(href);
                            hrefs.push(href);
                        }
                    });
                    if (startFromAtKey?.index && startFromAtKey.index > 0) {
                        hrefs = hrefs.slice(startFromAtKey.index);
                        setIndexAtLoopPosition(loopPosition, newPath, startFromAtKey.index);
                    }
                    // we are at the leaf of the startFrom path, clear it so we don't jump ahead
                    if (startFromAtKey?.index && !Object.keys(startFromAtKey).some(k => k !== 'index')) {
                        fetchContext.startFrom = {} as LoopPosition;
                    }
                }
            // We find paging information and loop through the pages
            } else if ('$pagedUrlPattern' in value) {
                let pageCount = 1;
                if (value['$pageCountSelector']) {
                    pageCount = parseInt(
                        itemGetter(value['$pageCountSelector']) || "1"
                    );
                    if (isNaN(pageCount) || pageCount < 1) {
                        returnVal[key] = errorOutput(`Invalid page count ${value['$pageCountSelector']}`);
                        continue;
                    }
                }
                let pageLength = 1;
                if (value['$pageLengthSelector']) {
                    pageLength = parseInt(
                        itemGetter(value['$pageLengthSelector']) || "1"
                    );
                    if (isNaN(pageLength) || pageLength < 1) {
                        returnVal[key] = errorOutput(`Invalid page length ${value['$pageLengthSelector']}`);
                        continue;
                    }
                }
                let itemCount = 0;
                if (value['$itemCountSelector']) {
                    itemCount = parseInt(
                        itemGetter(value['$itemCountSelector']) || "0"
                    );
                    if (isNaN(itemCount) || itemCount < 0) {
                        returnVal[key] = errorOutput(`Invalid item count ${value['$itemCountSelector']}`);
                        continue;
                    }
                }
                if (itemCount > 0) pageCount = Math.floor(itemCount / pageLength);
                hrefs = [];
                if (!returnsArray) pageCount = 1;
                if (fetchContext.maxFetches !== undefined && fetchContext.maxFetches <= 0) pageCount = 0;
                let initialIdx = idx || 0;
                if (startFromAtKey?.index && startFromAtKey.index > 0) {
                    setIndexAtLoopPosition(loopPosition, newPath, startFromAtKey.index);
                    initialIdx = startFromAtKey.index;
                }
                if (startFromAtKey?.index && !Object.keys(startFromAtKey).some(k => k !== 'index')) {
                    fetchContext.startFrom = {} as LoopPosition;
                }
                for (let i = initialIdx; i < pageCount; i++) {
                    const pattern = value['$pagedUrlPattern'];
                    const url = resolvePathPatternWithUrl(pattern, reqMsg.url, {
                        page0: i.toString(),
                        page1: (i + 1).toString(),
                        take: pageLength.toString(),
                        skip: (i * pageLength).toString()
                    });
                    hrefs.push(url as string);
                }
            // We recurse into a data object on this page
            } else if ('$embeddedDataSelector' in value) {
                if (returnsArray) {
                    const data = arrayGetter(value['$embeddedDataSelector']);
                    const items = data
                        .filter(item => item !== null);
                    const val = []
                    for (let idx = 0; idx < items.length; idx++) {
                        setIndexAtLoopPosition(loopPosition, newPath, idx);
                        val.push(await extractFromPage(value, newPath, parentResult, loopPosition, items[idx]!, fetchMimeType, reqMsg, fetchContext));
                    };
                    returnVal[key] = val;
                } else {
                    const data = itemGetter(value['$embeddedDataSelector'], idx);
                    if (data) {
                        setIndexAtLoopPosition(loopPosition, newPath, -1);
                        const val = await extractFromPage(value, newPath, parentResult, loopPosition, data, fetchMimeType, reqMsg, fetchContext);
                        returnVal[key] = val;
                    } else {
                        returnVal[key] = errorOutput(`No data found at ${value['$embeddedDataSelector']}`);
                    }
                }
                continue;
            // An object must have properties defined to create a new context for the other properties to extract data
            } else {
                returnVal[key] = errorOutput(`No url selector specified in subspec at ${key}`);
                continue;
            }

            // if we get this far, we have a list of hrefs to follow
            const retValues = [];
            const countsAsFetch = !('$embeddedDataSelector' in value) // embedded data doesn't need a fetch
                && returnsArray // don't count single items as fetches
                && !Object.values(value)
                    .some(v => typeof v === 'object'
                        && v !== null
                        && !('$embeddedDataSelector' in v)); // only count leaf fetches
            for (let idx = 0; idx < hrefs.length; idx++)
            {
                const href = hrefs[idx];
                if (!href) {
                    retValues.push(errorOutput(`No href found at ${value['$urlselector']}`));
                    continue;
                }
                const nextUrl = reqMsg.url.follow(href);
                const subReqMsg = new Message(nextUrl, fetchContext.serviceContext, 'GET', reqMsg);
                if (fetchMimeType.startsWith('application/json')) {
                    subReqMsg.setHeader('accept', 'application/json, text/javascript, */*; q=0.01');
                    subReqMsg.setHeader('X-Requested-With', 'XMLHttpRequest');
                }
                if (key === nextLoopKey) {
                    parentResult = { ...parentResult, ...returnVal };
                }
                incrementLoopPosition(loopPosition, newPath);
                const subReqVal: any = await scrapeFromSpec(value, newPath, parentResult, loopPosition, subReqMsg, fetchContext);
                if (subReqVal.$status && subReqVal.$message) return subReqVal;
                if (isLoopKey) {
                    const loopOutput = {
                        ...parentResult,
                        [key]: subReqVal
                    }
                    if (fetchContext.outputWriter) {
                        await fetchContext.outputWriter.write(new TextEncoder().encode(JSON.stringify(loopOutput) + "\n"));
                    }
                } else if (!nextLoopKey) {
                    // only add to return value if not a loop key
                    retValues.push(subReqVal);
                }
                if (fetchContext.maxFetches !== undefined) {
                    if (countsAsFetch && fetchContext.maxFetches > 0) {
                        fetchContext.maxFetches--;
                    }
                    if (fetchContext.maxFetches <= 0) {
                        break;
                    }
                }                  
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
	const spec = await msgSpec.data!.asJson();
	if (!spec) return msg.setStatus(400, 'No spec');
    if (!spec['$url']) return msg.setStatus(400, 'No url in spec');

    const reqStatus = reqSpec.copy();
    reqStatus.url.resourceName = reqStatus.url.resourceExtension
        ? reqStatus.url.resourceParts.slice(0, -1).concat([ 'status', 'json' ]).join('.')
        : reqStatus.url.resourceParts.concat([ 'status', 'json' ]).join('.');
    const msgStatus = await context.makeRequest(reqStatus);
    if (!msgStatus.ok && msgStatus.status !== 404) return msgStatus;
    if (msgStatus.status !== 404 && msgSpec?.data?.mimeType !== 'application/json') return msg.setStatus(400, 'Status is not JSON');
    const status = msgStatus.status === 404 ? {} : await msgStatus.data!.asJson();
    const startFrom = (status['startFrom'] || {}) as LoopPosition;

    // find the applicable url: the msgSpec location header tells you the url of the actual spec file
	// - the rest is the subpath of the url
	const contextUrl: Url = msg.url.copy();
	contextUrl.setSubpathFromUrl(msgSpec.getHeader('location') || '');

    const url = new Url(spec['$url']);

    const reqMsg = new Message(url, context, 'GET', msg);
    const state = await context.state(WebScraperState, context, config);
    const delayer = state.getDelayer(url.domain);
    const loopProperty = spec['$loopProperty'] as string | undefined;
    const loopPath = loopProperty?.split('.');
    const transformStream = loopProperty ? new TransformStream() : undefined;
    const fetchContext = {
        maxFetches: spec['$maxFetches'] || 0,
        delayer,
        serviceContext: context,
        startFrom,
        loopPath,
        outputWriter: transformStream?.writable?.getWriter()
    } as IFetchContext;
    const loopPosition = {} as LoopPosition;
    if (loopProperty) {
        (async () => {
            try {
                await scrapeFromSpec(spec, [], {}, loopPosition, reqMsg, fetchContext);
            } finally {
                await fetchContext.outputWriter!.close();
                status.startFrom = loopPosition;
                reqStatus.setMethod('PUT').setDataJson(status);
                await context.makeRequest(reqStatus);
            }
        })(); // don't wait for scrape to finish: return the stream immediately

        msg.setData(transformStream!.readable, "application/x-ndjson"); // message has an open stream which will be closed in scrapeFromSpec
    } else {
        const scrape = await scrapeFromSpec(spec, [], {}, loopPosition, reqMsg, fetchContext);
        if (scrape.$status && scrape.$message) return msg.setStatus(scrape.$status, scrape.$message);
        msg.setDataJson(scrape);
        status.startFrom = loopPosition;
        reqStatus.setMethod('PUT').setDataJson(status);
        await context.makeRequest(reqStatus);
    }
    return msg;
});

export default service;
