import { Url } from "rs-core/Url.ts";
import { Message } from "rs-core/Message.ts";
import { handleOutgoingRequest } from "./handleRequest.ts";

export const getSource = async (url: string | Url, tenant: string) => {
    let data: string;
    const urlStr = url instanceof Url ? url.toString() : url;
    if (urlStr.startsWith("https://") || urlStr.startsWith("http://") || urlStr.startsWith("/")) {
        const msg = new Message(url, tenant, "GET", null);
        const resp = await handleOutgoingRequest(msg);
        if (!resp.ok) throw new Error('Failed to get source: ' + urlStr);
        data = await resp.data?.asString() || '';
    } else {
        data = await Deno.readTextFile(urlStr);
    }
    return data;
};
