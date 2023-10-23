import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface SimpleProxyAdapterProps {
    urlPattern: string;
    basicAuthentication?: { username?: string, password: string },
    bearerToken?: string;
}

export default class SimpleProxyAdapter implements IProxyAdapter {
    urlPattern: string;

    constructor(public context: AdapterContext, public props: SimpleProxyAdapterProps) {
        this.urlPattern = props.urlPattern;
    }

    buildMessage(msg: Message) {
        const basic = this.props.basicAuthentication;
        if (basic) {
            const authString = `${basic.username || ''}:${basic.password}`;
            msg.setHeader('Authorization', `Basic ${btoa(authString)}`);
        } else if (this.props.bearerToken) {
            msg.setHeader('Authorization', `Bearer ${this.props.bearerToken}`);
        }

        return Promise.resolve(
            msg.setUrl(resolvePathPatternWithUrl(this.urlPattern, msg.url, msg.data) as string)
        );
    }
}