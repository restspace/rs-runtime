import { AWSSignerV4 } from "../../deno_aws_sign/mod.ts";
import { IProxyAdapter } from "../../rs-core/adapter/IProxyAdapter.ts";
import { Message } from "../../rs-core/Message.ts";
import { resolvePathPatternWithUrl } from "../../rs-core/PathPattern.ts";
import { AdapterContext } from "../../rs-core/ServiceContext.ts";

export interface AWS4ProxyAdapterProps {
    service: "s3";
    region: string;
    secretAccessKey: string;
    accessKeyId: string;
    urlPattern: string;
}


export default class AWS4ProxyAdapter implements IProxyAdapter {
  constructor(public context: AdapterContext, public props: AWS4ProxyAdapterProps) {
  }
    
  async buildMessage(msg: Message): Promise<Message> {
    const signer = new AWSSignerV4(this.props.region, {
      awsAccessKeyId: this.props.accessKeyId,
      awsSecretKey: this.props.secretAccessKey}
    );

    msg.setUrl(resolvePathPatternWithUrl(this.props.urlPattern, msg.url, msg.data) as string);
    // for now, don't use chunked signing method, just ensure data isn't a stream
    const req = await signer.sign(this.props.service, msg.toRequest());
    const msgOut = Message.fromRequest(req, msg.tenant);
    //if (msgOut.data) await msgOut.data.ensureDataIsArrayBuffer();

    return msgOut;
  }
}