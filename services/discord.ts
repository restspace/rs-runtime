import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { sign_detached_verify } from "https://cdn.jsdelivr.net/gh/intob/tweetnacl-deno@1.1.0/src/sign.ts";
import { hex2array } from "rs-core/utility/utility.ts";
import { buildDefaultDirectory, buildStore } from "rs-core/WrapperBuilder.ts";
import { DirDescriptor, PathInfo } from "rs-core/DirDescriptor.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { IDiscordConfig } from "./discord/IDiscordConfig.ts";
import { DiscordState } from "./discord/DiscordState.ts";
import { sendTrigger } from "./discord/sendTrigger.ts";

const service = new Service<IDataAdapter, IDiscordConfig>();

service.initializer(async (context, config) => {
	await context.state(DiscordState, context, config);
	//await state.load(context, config);
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

	const intResp = await sendTrigger("INTERACTION_CREATE", json?.data, config.triggerUrl, context);
	msg.setDataJson(intResp).setStatus(200);
	return msg;
});

service.getPath("command/.schema.json", (msg) =>
	Promise.resolve(msg.setDataJson(commandSchema, "application/schema+json")));

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

// The $ substitution here is a url pattern to pick up the service configuration data
// which is matched against in MapUrl
const applicationPath = 'applications/${proxyAdapterConfig.applicationId}';

buildStore({
	basePath: "/command/global",
	service,
	schema: commandSchema,
	mapUrlRead: msg => [  `${applicationPath}/commands/${extractId(msg)}`, "GET" ],
	mapUrlWrite: msg => [ `${applicationPath}/commands/${extractId(msg)}`, "PATCH" ],
	mapUrlDelete: msg => [ `${applicationPath}/commands/${extractId(msg)}`, "DELETE" ],
	createTest: msg => !extractId(msg),
	mapUrlCreate: _ => [ `${applicationPath}/commands`, "POST" ],
	mapUrlDirectoryRead: applicationPath + "/commands",
	transformDirectory
});

buildStore({
	basePath: "/command",
	service,
	schema: commandSchema,
	mapUrlRead: msg => [ `${applicationPath}/guilds/$>0/commands/${extractId(msg)}`, "GET" ],
	mapUrlWrite: msg => [ `${applicationPath}/guilds/$>0/commands/${extractId(msg)}`, "PATCH" ],
	mapUrlDelete: msg => [ `${applicationPath}/guilds/$>0/commmands/${extractId(msg)}`, "DELETE" ],
	createTest: msg => !extractId(msg),
	mapUrlCreate: _ => [ `${applicationPath}/guilds/$>0/commands`, "POST" ],
	mapUrlDirectoryRead:  applicationPath + "/guilds/$>0/commands",
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