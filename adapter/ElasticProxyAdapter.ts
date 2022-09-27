import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";

export interface ElasticProxyAdapterProps {
    username: string;
    password: string;
    host: string;
}

export default class ElasticProxyAdapter implements IProxyAdapter {

  constructor(public context: AdapterContext, public props: ElasticProxyAdapterProps) {
    if (!(props.host)) {
      throw new Error('Must supply host for Elastic');
    }
  }
    
  buildMessage(msg: Message): Promise<Message> {
    if (this.props.username && this.props.password) {
      const token = btoa(`${this.props.username}:${this.props.password}`);
      msg.setHeader('Authorization', `Basic ${token}`);
    }
    const newUrl = msg.url.copy();
    const hostUrl = new Url(this.props.host);
    newUrl.domain = hostUrl.domain;
    newUrl.scheme = hostUrl.scheme;
    return Promise.resolve(msg.setUrl(newUrl));
  }
}