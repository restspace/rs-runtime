import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";
import { pathCombine } from "rs-core/utility/utility.ts";

export interface DiscordProxyAdapterProps {
    botToken: string;
    applicationId: string;
}

const discordBaseUrl = "https://discord.com/api/v10";

export default class DiscordProxyAdapter implements IProxyAdapter {
  constructor(public context: AdapterContext, public props: DiscordProxyAdapterProps) {
  }
    
  buildMessage(msg: Message): Promise<Message> {
    const url = new Url(pathCombine(discordBaseUrl, msg.url.path));
    url.queryString = msg.url.queryString;
    url.fragment = msg.url.fragment;
    console.log(url.toString());
    msg.url = url;
    msg.setHeader("Authorization", "Bot " + this.props.botToken);
    msg.setHeader("User-Agent", "DiscordBot (https://restspace.io, 0.1)");
    return Promise.resolve(msg);
  }
}