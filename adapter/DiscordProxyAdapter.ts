import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";
import { pathCombine } from "rs-core/utility/utility.ts";

export interface DiscordProxyAdapterProps {
    botToken: string;
    applicationId: string;
}

const discordBaseUrl = "https://discord.com/api/v8";

export default class DiscordProxyAdapter implements IProxyAdapter {
  constructor(public context: AdapterContext, public props: DiscordProxyAdapterProps) {
  }
    
  buildMessage(msg: Message): Promise<Message> {
    const url = pathCombine(discordBaseUrl, `applications/${this.props.applicationId}`, msg.url.path);
    msg.url = new Url(url);
    msg.setHeader("Authorization", "Bot " + this.props.botToken);
    msg.setHeader("User-Agent", "DiscordBot (https://restspace.io, 0.1)");
    return Promise.resolve(msg);
  }
}