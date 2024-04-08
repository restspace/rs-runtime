import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface BotProxyAdapterProps {
    urlPattern?: string;
}

const botUserAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15"
];

export default class BotProxyAdapter implements IProxyAdapter {
    urlPattern?: string;

    constructor(public context: AdapterContext, public props: BotProxyAdapterProps) {
        this.urlPattern = props.urlPattern;
    }

    buildMessage(msg: Message) {
        msg.setHeader('User-Agent', botUserAgents[Math.floor(Math.random() * botUserAgents.length)]);
        msg.setHeader("Accept-Language", "en-US,en;q=0.9");
        if (!msg.getHeader("Accept")) msg.setHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9");
        //msg.setHeader("Accept-Encoding", "gzip, deflate, br");
        msg.setHeader("Referer", "https://www.google.com/");

        if (this.urlPattern) {
            msg.setUrl(resolvePathPatternWithUrl(this.urlPattern, msg.url, msg.data) as string);
        }

        return Promise.resolve(msg);
    }
}