import { ITriggerServiceConfig } from "rs-core/IServiceConfig.ts";
import { Intent } from "./Intent.ts";

export interface IDiscordConfig extends ITriggerServiceConfig {
	publicKey: string; 
	guildIds?: string[];
	receiveIntents?: Intent[];
	memberStoreUrl?: string;
	messageStoreUrl?: string;
}