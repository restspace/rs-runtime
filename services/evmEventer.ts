import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import Web3 from "https://deno.land/x/web3/mod.ts";
import { BaseStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { Message } from "rs-core/Message.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { pathCombine } from "rs-core/utility/utility.ts";

interface EvmEventerConfig extends IServiceConfig {
    triggerUrlBase: string;
    contractAddress: string;
    alchemyHttpsUrl: string;
	userUrlIndexedByAddress: string; // address pattern ${address}
}

const getAuthUser = async (sender: string, userAddressUrl: string, context: SimpleServiceContext) => {
	const msg = Message.fromSpec("GET " + userAddressUrl, context.tenant, undefined, { address: sender }) as Message;
	const res = await context.makeRequest(msg);
	if (!res.ok) return null;
	return new AuthUser(await res.data?.asJson());
}

const eventHandler = (context: SimpleServiceContext, config: EvmEventerConfig) => async (ev: any) => {
	const user = await getAuthUser(ev.returnValues.sender, config.userUrlIndexedByAddress, context);
	const msg = new Message(pathCombine(config.triggerUrlBase, ev.returnValues.url), context.tenant, "POST", null);
	msg.user = user ? user : new AuthUser({});
	msg.setDataJson(ev.returnValues.json);
	await context.makeRequest(msg);
};

const options = {
    fromBlock: 'latest'
};

class EvmEventerState extends BaseStateClass {
	eventerContract: InstanceType<Web3["eth"]["Contract"]> | null = null;
	eventHandler: ((ev: any) => Promise<void>) | null = null;

	async load(context: SimpleServiceContext, config: EvmEventerConfig): Promise<void> {
		const web3 = new Web3(new Web3.providers.WebsocketProvider(config.alchemyHttpsUrl));
		this.eventerContract = new web3.eth.Contract(abi, config.contractAddress);
		this.eventHandler = eventHandler(context, config);
		const evt = this.eventerContract.events.LogEvent(options, (err: any, ev: any) => {
			if (err) {
				context.logger.error(err);
			} else if (this.eventHandler) {
				this.eventHandler(ev);
			}
		});
	}
	async unload(): Promise<void> {
	}
}

type AbiType = 'function' | 'constructor' | 'event' | 'fallback';
type StateMutabilityType = 'pure' | 'view' | 'nonpayable' | 'payable';

const abi = [
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "sender",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "string",
				"name": "url",
				"type": "string"
			},
			{
				"indexed": false,
				"internalType": "string",
				"name": "json",
				"type": "string"
			}
		],
		"name": "LogEvent",
		"type": "event" as AbiType
	},
	{
		"inputs": [
			{
				"internalType": "string",
				"name": "url",
				"type": "string"
			},
			{
				"internalType": "string",
				"name": "json",
				"type": "string"
			}
		],
		"name": "log",
		"outputs": [],
		"stateMutability": "nonpayable" as StateMutabilityType,
		"type": "function" as AbiType
	}
];

const service = new Service<IAdapter, EvmEventerConfig>();

service.initializer(async (context, config) => {
	await context.state(EvmEventerState, context, config);
});

export default service;