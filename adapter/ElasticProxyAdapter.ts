import { IProxyAdapter } from "../../rs-core/adapter/IProxyAdapter.ts";
import { Message } from "../../rs-core/Message.ts";
import { AdapterContext } from "../../rs-core/ServiceContext.ts";

export interface ElasticProxyAdapterProps {
    username: string;
    password: string;
    domainAndPort: string;
}

export default class ElasticProxyAdapter implements IProxyAdapter {

  constructor(public context: AdapterContext, public props: ElasticProxyAdapterProps) {
    if (!(props.username && props.password && props.domainAndPort)) {
      throw new Error('Must supply username, password and domain/port for Elastic');
    }
  }
    
  buildMessage(msg: Message): Promise<Message> {
    const token = btoa(`${this.props.username}:${this.props.password}`);
    const newUrl = msg.url.copy();
    newUrl.domain = this.props.domainAndPort;
    newUrl.scheme = "https://";
    return Promise.resolve(msg.setUrl(newUrl).setHeader('Authorization', `Basic ${token}`));
  }
}