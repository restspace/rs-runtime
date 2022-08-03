import { Service } from "rs-core/Service.ts";
import { ITriggerServiceConfig } from "rs-core/IServiceConfig.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { sign_detached_verify } from "https://cdn.jsdelivr.net/gh/intob/tweetnacl-deno@1.1.0/src/sign.ts";
import { hex2array } from "rs-core/utility/utility.ts";
import { buildDefaultDirectory, buildStore } from "rs-core/WrapperBuilder.ts";
import { DirDescriptor, PathInfo } from "rs-core/DirDescriptor.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { contextOrFrameLookup } from "https://deno.land/x/nunjucks@3.2.3/src/runtime.js";
import { BaseStateClass, SimpleServiceContext } from "../../rs-core/ServiceContext.ts";

type Intent = "GUILDS" | "GUILD_MEMBERS" | "GUILD_BANS" | "GUILD_EMOJIS_AND_STICKERS" |
			   "GUILD_INTEGRATIONS" | "GUILD_WEBHOOKS" | "GUILD_INVITES" |
			   "GUILD_VOICE_STATES" | "GUILD_PRESENCES" | "GUILD_MESSAGES" |
			   "GUILD_MESSAGE_REACTIONS" | "GUILD_MESSAGE_TYPING" | "DIRECT_MESSAGES" |
			   "DIRECT_MESSAGE_REACTIONS" | "DIRECT_MESSAGE_TYPING" | "MESSAGE_CONTENT" |
			   "GUILD_SCHEDULED_EVENTS" | "AUTO_MODERATED_CONFIGURATION" | "AUTO_MODERATED_EXECUTION";

interface IDiscordConfig extends ITriggerServiceConfig {
	publicKey: string; 
	guildIds?: string[];
	receiveIntents?: Intent[];
}

const service = new Service<IDataAdapter, IDiscordConfig>();

class DiscordState extends BaseStateClass {
	//const ws: WebSocket;

	async load(context: SimpleServiceContext) {
		const gatewayLocationMsg = await context.makeProxyRequest!(
			Message.fromSpec("GET /gateway/bot", context.tenant) as Message
		);
		//if (!gatewayLocationMsg.ok) throw 
	}
}

service.initializer(async (context, config) => {
	//const _dummyState = context.state(StateClass, context, config); // fetch the state to construct & initialize it
});

const commandSchema = {
	type: "object",
	properties: {
		id: { type: "string", readOnly: true },
		type: { type: "number", enum: [ 1, 2, 3 ], enumText: [ "Chat Input (slash command)", "User (rt click a user)", "Message (rt click a message)" ] },
		name: { type: "string", description: "Name of the command", maxLength: 32 },
		description: { type: "string", maxLength: 100 },
		default_permission: { type: "boolean" },
		version: { type: "string", readOnly: true },
		options: { type: "array",
			items: {
				type: "object",
				properties: {
					type: { type: "number", enum: [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 ], enumText: [
						"Subcommand",
						"Subcommand Group",
						"String",
						"Integer",
						"Boolean",
						"User",
						"Channel",
						"Role",
						"Mentionable",
						"Number",
						"Attachment"
					 ] },
					name: { type: "string", maxLength: 32 },
					description: { type: "string", maxLength: 100 },
					required: { type: "boolean" },
					choices: {
						type: "object",
						properties: {
							name: { type: "string" },
							value: { type: "string" }
						}
					},
					channel_types: { type: "array",
						items: {
							type: "number",
							enum: [ 0, 1, 2, 3, 4, 5, 6, 13 ],
							enumText: [
								"Guild text",
								"DM",
								"Guild voice",
								"Group DM",
								"Guild category",
								"Guild news",
								"Guild store",
								"Guild stage voice"
							]
						}
					},
					min_value: { type: "number" },
					max_value: { type: "number" },
					autocomplete: { type: "boolean" }
				},
				required: [ "type", "name", "description" ]
			}
		}
	},
	required: [ "name", "description" ],
	pathPattern: '${name}|${id}'
};
const interactionMessageSchema = {
	type: "object",
	properties: {
		tts: { type: "boolean" },
		content: { type: 'string' },
		embeds: {
			type: "array",
			items: {
				type: "object",
				properties: {
					title: { type: "string" },
					type: { type: "string", enum: [ "rich", "image", "video", "gifv", "article", "link" ] }
				}
			}
		}
	}
};

const verify = async (msg: Message, config: IDiscordConfig) => {
	const signature = msg.getHeader('X-Signature-Ed25519');
	const timestamp = msg.getHeader('X-Signature-Timestamp');
	const body = await msg.data?.asString();
	if (!(signature && timestamp && body)) return false;
	const enc = new TextEncoder();
	const isVerified = sign_detached_verify(
		enc.encode(timestamp + body),
		hex2array(signature),
		hex2array(config.publicKey)
	);
	return isVerified;
}

const snowflakeToTimestamp = (snf: string) => {
	const snfi = Number(BigInt(snf) >> 22n);
	return snfi + 1420070400000;
}

interface IIntResponse {
	type: number;
	data?: IIntMessage;
}

interface IIntMessage {
	content?: string;
}

const messageToInteractionResponse = async (msg: Message) => {
	const intResponse = {
		type: 4
	} as IIntResponse;
	let intMessage = {} as IIntMessage;
	if (!msg.data) return intResponse;
	switch (msg.data.mimeType) {
		case "text/plain": {
			intMessage.content = (await msg.data.asString()) || undefined;
			break;
		}
		case "application/json": {
			intMessage = await msg.data.asJson();
			break;
		}
	}
	intResponse.data = intMessage;
	return intResponse;
}

// incoming interaction from Discord
service.postPath("interaction", async (msg, context, config) => {
	if (!await verify(msg, config)) {
		console.log('Invalid');
		return msg.setStatus(401, 'invalid request signature');
	}
	const json = await msg.data?.asJson();

	// handle ping from Discord
	if (json.type === 1) {
		console.log('PING');
		return msg.setDataJson({ type: 1 }).setStatus(200);
	}

	let respMsg: Message;
	if (config.triggerUrl) {
		const url = config.triggerUrl.replace('${name}', json?.data?.name || '');
		const reqMsg = new Message(url as string, context.tenant, "GET");
		respMsg = await context.makeRequest(reqMsg);
	} else {
		respMsg = new Message('/', context.tenant, 'GET');
		respMsg.setStatus(400, "Configuration error in bot: no processor");
	}
	const intResp = await messageToInteractionResponse(respMsg);
	msg.setDataJson(intResp).setStatus(200);
	return msg;
});

service.getPath("command/.schema.json", (msg) =>
	Promise.resolve(msg.setDataJson(commandSchema, "application/schema+json")));

// const processArgs = (msg: Message): [ string, string ] | string => {
// 	const scope = msg.url.servicePathElements[0];
// 	let nameId = msg.url.servicePathElements[1];
// 	if (nameId.endsWith('.json')) nameId = nameId.slice(0, -5);
// 	if (!scope) return 'no scope for command';
// 	if (!/^(global|[0-9]{18})$/.test(scope)) return 'scope not 18 digit snowflake id or "global"';
// 	if (!nameId) return 'missing command name-id';
// 	const [ _, id ] = decodeURIComponent(nameId).split('|');
// 	if (id && !/^[0-9]{18}$/.test(id)) return 'id part of resource is present but is not 18 digit snowflake id';
// 	return [ scope, id?.trim() ];
// }

const extractId = (msg: Message) => {
	const id = decodeURIComponent(msg.url.servicePathElements[1]?.replace(/.json$/, '')).split('|')?.[1];
	return id;
}
const transformDirectory = (json: any) => {
	const entries: any[] = json;
	return {
		paths: entries.map(ent => [
			commandSchema.pathPattern.replace("${name}", ent.name).replace("${id}", ent.id),
			snowflakeToTimestamp(ent.version)
		])
	};
};

buildStore({
	basePath: "/command/global",
	service,
	schema: commandSchema,
	mapUrlRead: msg => [ `commands/${extractId(msg)}`, "GET" ],
	mapUrlWrite: msg => [ `commands/${extractId(msg)}`, "PATCH" ],
	mapUrlDelete: msg => [ `commands/${extractId(msg)}`, "DELETE" ],
	createTest: msg => !extractId(msg),
	mapUrlCreate: _ => [ "commands", "POST" ],
	mapUrlDirectoryRead: "commands",
	transformDirectory
});

buildStore({
	basePath: "/command",
	service,
	schema: commandSchema,
	mapUrlRead: msg => [ `guilds/$>0/commands/${extractId(msg)}`, "GET" ],
	mapUrlWrite: msg => [ `guilds/$>0/commands/${extractId(msg)}`, "PATCH" ],
	mapUrlDelete: msg => [ `guilds/$>0/commmands/${extractId(msg)}`, "DELETE" ],
	createTest: msg => !extractId(msg),
	mapUrlCreate: _ => [ "guilds/$>0/commands", "POST" ],
	mapUrlDirectoryRead: "guilds/$>0/commands",
	transformDirectory
});

buildDefaultDirectory({
	basePath: "/",
	service
});

service.getDirectoryPath("/command/.", (msg, _, config) => {
	const dir = {
		path: msg.url.servicePath,
		paths: [
			[ "global/" ],
			...(config.guildIds || []).map(id => [ id + "/" ] as PathInfo)
		],
		spec: {
			pattern: "view",
			respMimeType: "text/plain"
		}
	} as DirDescriptor;
	msg.data = MessageBody.fromObject(dir).setIsDirectory();
    return Promise.resolve(msg);
});

export default service;