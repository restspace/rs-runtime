import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface SlackProxyAdapterProps {
    botToken: string;
    apiVersion?: string;
}

export default class SlackProxyAdapter implements IProxyAdapter {
    private baseUrl = "https://slack.com/api";
    private apiVersion: string;

    constructor(public context: AdapterContext, public props: SlackProxyAdapterProps) {
        this.apiVersion = props.apiVersion || "v2";
    }

    buildMessage(msg: Message): Promise<Message> {
        // Add Slack authentication
        msg.setHeader('Authorization', `Bearer ${this.props.botToken}`);
        
        // Add required headers for Slack API
        msg.setHeader('Content-Type', 'application/json; charset=utf-8');

        // Ensure URL is properly formatted for Slack API
        const slackEndpoint = msg.url.path.startsWith('/') ? msg.url.path.substring(1) : msg.url.path;
        const fullUrl = `${this.baseUrl}/${slackEndpoint}`;
        
        return Promise.resolve(msg.setUrl(fullUrl));
    }
} 