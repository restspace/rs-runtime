import { AWSSignerV4 } from "../../deno_aws_sign/mod.ts";
import { IProxyAdapter } from "../../rs-core/adapter/IProxyAdapter.ts";
import { Message } from "../../rs-core/Message.ts";
import { resolvePathPatternWithUrl } from "../../rs-core/PathPattern.ts";
import { AdapterContext } from "../../rs-core/ServiceContext.ts";

export interface AWS4ProxyAdapterProps {
    service: "s3";
    region: string;
    secretAccessKey?: string;
    accessKeyId?: string;
    ec2IamRole?: string;
    urlPattern: string;
}


export default class AWS4ProxyAdapter implements IProxyAdapter {
  tempKeysValiditySecs = 21600;
  expiration?: Date;
  signer?: AWSSignerV4;
  sessionToken?: string;

  setSigner(accessKeyId: string, secretAccessKey: string) {
    this.signer = new AWSSignerV4(this.props.region, {
      awsAccessKeyId: accessKeyId,
      awsSecretKey: secretAccessKey
    });
  }

  constructor(public context: AdapterContext, public props: AWS4ProxyAdapterProps) {
    if (!(props.accessKeyId && props.secretAccessKey) && !props.ec2IamRole) {
      throw new Error('Must supply access keys or an EC2 IAM role');
    }
    const { accessKeyId, secretAccessKey } = props;
    if (accessKeyId && secretAccessKey) {
      this.setSigner(accessKeyId, secretAccessKey)
    }
  }

  async getEc2TempKeys() {
    try {
        const tokenResp = await fetch("http://169.254.169.254/latest/api/token", {
            method: "PUT",
            headers: {
                "X-aws-ec2-metadata-token-ttl-seconds": this.tempKeysValiditySecs.toString()
            }
        });
        if (!tokenResp.ok) throw new Error(`Request failed status ${tokenResp.status} ${tokenResp.statusText}`);
        const token = await tokenResp.text();
        const keysResp = await fetch(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${this.props.ec2IamRole}`, {
            headers: {
                "X-aws-ec2-metadata-token": token
            }
        });
        if (!keysResp.ok) throw new Error('Failed to get AWS temporary credentials');
        const keys = await keysResp.json();
        const { AccessKeyId: accessKeyId, SecretAccessKey: secretAccessKey, Token: sessionToken } = keys;
        this.setSigner(accessKeyId, secretAccessKey);
        this.expiration = new Date(keys.expiration);
        this.sessionToken = sessionToken;
    } catch (err) {
        this.context.logger.error(`Failed to get £C2 temp keys: ${err}`);
    }
}
    
  async buildMessage(msg: Message): Promise<Message> {
    msg.setUrl(resolvePathPatternWithUrl(this.props.urlPattern, msg.url, msg.data) as string);

    if (!(this.props.accessKeyId && this.props.secretAccessKey)
        || (this.expiration && new Date() > this.expiration)) {
          await this.getEc2TempKeys();
    }

    if (this.sessionToken) msg.setHeader("X-Amz-Security-Token", this.sessionToken);
    // for now, don't use chunked signing method, just ensure data isn't a stream
    const req = await this.signer!.sign(this.props.service, msg.toRequest());
    const msgOut = Message.fromRequest(req, msg.tenant);
    //if (msgOut.data) await msgOut.data.ensureDataIsArrayBuffer();
    msg.setMetadataOn(msgOut);
    return msgOut;
  }
}