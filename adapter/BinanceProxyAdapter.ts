import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";

export interface BinanceProxyAdapterProps {
    apiKey: string;
    privateKey: string;
}

export default class BinanceProxyAdapter implements IProxyAdapter {

  constructor(public context: AdapterContext, public props: BinanceProxyAdapterProps) {
    if (!(props.apiKey)) {
      throw new Error('Must supply api key for Binance');
    }
  }

  getBaseUrl(): Url {
    return new Url('https://api3.binance.com');
  }
    
  buildMessage(msg: Message): Promise<Message> {
    if (this.props.apiKey) {
      msg.setHeader('X-MBX-APIKEY', this.props.apiKey);
    }
    const newUrl = msg.url.copy();
    const hostUrl = this.getBaseUrl();
    newUrl.domain = hostUrl.domain;
    newUrl.scheme = hostUrl.scheme;
    if (!newUrl.path.startsWith('api/v3/')) newUrl.path = 'api/v3/' + newUrl.path;
    return Promise.resolve(msg.setUrl(newUrl));
  }
}