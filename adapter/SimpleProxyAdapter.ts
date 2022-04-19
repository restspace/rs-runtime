import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "../../rs-core/Message.ts";
import { resolvePathPatternWithUrl } from "../../rs-core/PathPattern.ts";
import { AdapterContext } from "../../rs-core/ServiceContext.ts";

export interface SimpleProxyAdapterProps {
    urlPattern: string;
}

export default class SimpleProxyAdapter implements IProxyAdapter {
    urlPattern: string;

    constructor(public context: AdapterContext, public props: SimpleProxyAdapterProps) {
        this.urlPattern = props.urlPattern;
    }

    buildMessage(msg: Message) {
        return Promise.resolve(
            msg.setUrl(resolvePathPatternWithUrl(this.urlPattern, msg.url, msg.data) as string)
        );
    }
}