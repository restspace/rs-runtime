export type Snowflake = string;

export interface IIntResponse {
	type: number;
	data?: IIntMessage;
}

export interface IIntMessage {
	content?: string;
}

export type EventName = "GUILD_CREATE" | "INTERACTION_CREATE" | "READY"
	| "MESSAGE_CREATE" | "MESSAGE_DELETE" | "MESSAGE_UPDATE"
	| "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE" | "MESSAGE_REACTION_REMOVE_ALL" | "MESSAGE_REACTION_REMOVE_EMOJI"
	| "GUILD_MEMBER_ADD" | "GUILD_MEMBER_REMOVE" | "GUILD_MEMBER_UPDATE";

export enum Op {
	Event = 0,
	Heartbeat = 1,
	Identify = 2,
	Hello = 10,
	HeartbeatAck = 11
}

export interface SocketMsg {
	op: Op;
	d: Record<string, unknown>;
	t: EventName;
}

export interface UnavailableGuild {
	id: Snowflake;
}

export interface ReadyEvent {
	guilds: UnavailableGuild[];
	session_id: string;
}