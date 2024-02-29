import { Service } from "rs-core/Service.ts";
import { Url } from "rs-core/Url.ts";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";

interface IChange {
    from: string | Record<string, unknown>;
    to: Record<string, unknown>;
}

const ChangeSchema = {
    type: 'object',
    properties: {
        from: { type: [ 'string', 'object' ] },
        to: { type: 'object' }
    },
    required: [ 'from', 'to' ]
};

interface IReference {
    referencePointer: string;
    referredUrl: string;
}

// schema of array of IReference
const ReferencesSchema = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            referencePointer: { type: 'string' },
            referredUrl: { type: 'string' }
        },
        required: [ 'referencePointer', 'referredUrl' ]
    }
};

const extractReferenceProps = ([head, ...rest]: string[], val: any): string[] => {
    if (head === undefined) return [];
    const current = val[head];
    if (Array.isArray(current)) {
        if (current.length === 0) {
            return [];
        } else if (typeof current[0] === 'object') {
            const results = current.map((el: any) => extractReferenceProps(rest, el));
            return results.flat();
        } else if (typeof current[0] === 'string' && rest.length === 0) {
            return current;
        } else {
            return [];
        }
    } else if (typeof current === 'object') {
        return extractReferenceProps(rest, current);
    } else if (typeof current === 'string' && rest.length === 0) {
        return [current];
    } else {
        return [];
    }
}

const extractReferences = ({referencePointer, referredUrl}: IReference, val: any): string[] => {
    const refProps = referencePointer.split('/').filter(el => !!el);
    return extractReferenceProps(refProps, val).map((urlString: string) => {
        const url = new Url(urlString);
        if (url.isRelative) url.isRelative = false;
        return resolvePathPatternWithUrl(referredUrl, new Url(url));
    }).flat();
}

const service = new Service();

service.post(async (msg, context) => {
    const change = await msg.data?.asJson() as IChange;

    const reqReferences = msg.copy().setMethod("GET");
	const msgReferences = await context.makeRequest(reqReferences);
	if (!msgReferences.ok) return msgReferences;
    if (msgReferences?.data?.mimeType !== 'application/json') return msg.setStatus(400, 'References spec is not JSON');
	const references = await msgReferences.data!.asJson() as IReference[];
	if (!references) return msg.setStatus(400, 'No references spec');
    
    let from = change.from;
    // if from is a string, use it as a url to fetch the from object
    if (typeof from === 'string') {
        let url: Url;
        try {
            url = new Url(from);
        } catch {
            return msg.setStatus(400, `Invalid URL: ${from}`);
        }
        const fromMsg = msg.copy().setUrl(url).setMethod("GET");
        const fromResp = await context.makeRequest(fromMsg);
        if (!fromResp.ok) return fromResp;
        from = await fromResp.data?.asJson();
    }

    const contextUrl: Url = msg.url.copy();
	contextUrl.setSubpathFromUrl(msgReferences.getHeader('location') || '');

    const fromReferredUrls = new Set<string>(references.map(ref => extractReferences(ref, from)).flat());
    const toReferredUrls = new Set<string>(references.map(ref => extractReferences(ref, change.to)).flat());
    const changes = {
        deletions: Array.from(fromReferredUrls).filter(url => !toReferredUrls.has(url))
    };

    switch (contextUrl.subPathElements[0]) {
        case "changes": {
            msg.setDataJson(changes);
            break;
        }
        case "apply": {
            const deletionsPromises = changes.deletions.map(url => {
                const delMsg = msg.copy().setUrl(new Url(url)).setMethod("DELETE");
                return context.makeRequest(delMsg);
            });
            const delResps = await Promise.all(deletionsPromises);
            const delErrorCount = delResps.filter(resp => !resp.ok).length;
            if (delErrorCount > 0) return msg.setStatus(500, `Failed to delete ${delErrorCount} references`);
            msg.setStatus(200, `Deleted ${changes.deletions.length} references`);
            break;
        }
    }

    return msg;
});

export default service;