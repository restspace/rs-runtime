import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { Service } from "rs-core/Service.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { ethers } from "npm:ethers@^5.7";
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

const eventHandler = (context: SimpleServiceContext, config: EvmEventerConfig) => async (sender: string, url: string, json: string) => {
	const user = await getAuthUser(sender, config.userUrlIndexedByAddress, context);
	const msg = new Message(pathCombine(config.triggerUrlBase, url), context.tenant, "POST", null);
	msg.user = user ? user : new AuthUser({});
	msg.setDataJson(json);
	await context.makeRequest(msg);
};

class EvmEventerState extends BaseStateClass {
	eventerContract: ethers.Contract | null = null;
	eventHandler: ((sender: string, url: string, json: string) => Promise<void>) | null = null;

	async load(context: SimpleServiceContext, config: EvmEventerConfig): Promise<void> {
		const provider = new ethers.providers.JsonRpcProvider(config.alchemyHttpsUrl);
		provider.on("error", (err) => {
			context.logger.critical('provider error: ' + JSON.stringify(err));
		});
		this.eventerContract = new ethers.Contract(config.contractAddress, abi, provider);
		this.eventHandler = eventHandler(context, config);
		this.eventerContract.on("LogEvent", this.eventHandler);
	}
	async unload(): Promise<void> {
		if (this.eventHandler) this.eventerContract?.off("LogEvent", this.eventHandler);
	}
}

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
		"type": "event"
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
		"stateMutability": "nonpayable",
		"type": "function"
	}
];

const service = new Service<IAdapter, EvmEventerConfig>();

service.initializer(async (context, config) => {
	await context.state(EvmEventerState, context, config);
});

export default service;