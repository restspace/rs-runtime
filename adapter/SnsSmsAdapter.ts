import { ISmsAdapter } from "rs-core/adapter/ISmsAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";

export interface SnsSmsAdapterProps {
    region: string;
	secretAccessKey?: string;
	accessKeyId?: string;
    ec2IamRole?: string;
}

export default class SnsSmsAdapter implements ISmsAdapter {
    aws4ProxyAdapter: IProxyAdapter | null = null;
    
    constructor(public context: AdapterContext, public props: SnsSmsAdapterProps) {}

    async ensureProxyAdapter() {
        if (this.aws4ProxyAdapter === null) {
            this.aws4ProxyAdapter = await this.context.getAdapter<IProxyAdapter>("./adapter/AWS4ProxyAdapter.ts", {
                service: "sns",
                region: this.props.region,
                secretAccessKey: this.props.secretAccessKey,
                accessKeyId: this.props.accessKeyId,
                urlPattern: `https://sns.${this.props.region}.amazonaws.com/$P*`,
                ec2IamRole: this.props.ec2IamRole
            });
        }
	}

    async processForAws(msg: Message): Promise<Message> {
		await this.ensureProxyAdapter();
        msg.startSpan(this.context.traceparent, this.context.tracestate);
		const msgOut = await this.aws4ProxyAdapter!.buildMessage(msg);
		return msgOut;
	}

    async send(phoneNumber: string, message: string): Promise<number> {
        const queryParams = `Action=Publish&PhoneNumber=${phoneNumber}&Message=${encodeURIComponent(message)}&Version=2010-03-31`;
        const msg = new Message('/', this.context.tenant, "POST", null);
        msg.setData(queryParams, "application/x-www-form-urlencoded");
        const awsMsg = await this.processForAws(msg);
        const resp = await fetch(awsMsg.toRequest());
        const msgOut = Message.fromResponse(resp, this.context.tenant);
        if (!msgOut.ok) {
            this.context.logger.error('AWS SNS send error: ' + (await msgOut.data?.asString()));
        }
        return msgOut.ok ? 200 : msgOut.status;
    }
}