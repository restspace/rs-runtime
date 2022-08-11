import { Message } from "rs-core/Message.ts";
import { BaseStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { IDiscordConfig } from "./IDiscordConfig.ts";
import { Intent, intentsNumber } from "./Intent.ts";
import { IIntResponse, Op, ReadyEvent, Snowflake, SocketMsg } from "./MessageTypes.ts";
import { sendTrigger } from "./sendTrigger.ts";

export interface MemberInfo {
	id: Snowflake;
	username: string;
	discriminator: string;
	locale?: string;
	verified?: boolean;
	email?: string;
	roles: Snowflake[];
	joinedAt: Date;
	leftAt?: Date;
	pending?: boolean;
}

export interface GuildChannel {
	id: Snowflake;
	name: string;
}

export interface GuildInfo {
	id: Snowflake;
	botJoined: Date;
	memberCount: number;
	members: MemberInfo[];
	channels: GuildChannel[];
}

export class DiscordState extends BaseStateClass {
	ws: WebSocket | null | "opening" | "closed" = null;
	wsState: "initializing" | "identifying" | "running" | "closed" = "initializing";
	heartbeatInterval?: number;
	intervalId?: number;
	heartbeatAcked: boolean | null = null;
	token?: string;
	receiveIntents: Intent[] = [];
	context?: SimpleServiceContext;
	sessionId?: string;
	triggerUrl?: string;
	guilds?: Record<Snowflake, GuildInfo | null>;

	async load(context: SimpleServiceContext, config: IDiscordConfig) {
		if (this.ws !== null) return;
		this.ws = "opening";
		this.token = config.proxyAdapterConfig!.botToken as string;
		this.receiveIntents = config.receiveIntents || [];
		this.triggerUrl = config.triggerUrl;
		this.context = context;
		const gatewayLocationMsg = await context.makeProxyRequest!(
			Message.fromSpec("GET /gateway/bot", context.tenant) as Message
		);
		const gatewayInfo = await gatewayLocationMsg.data!.asJson();
		console.log(gatewayInfo);
		const ws = new WebSocket(gatewayInfo.url + "?v=10&encoding=json");
		ws.addEventListener('message', (ev) => this.receive(ev.data));
		ws.addEventListener('close', (ev) => this.close(ev));
		await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()));
		if (this.wsState === "closed") {
			ws.close();
		} else {
			this.ws = ws;
		}
	}

	resume() {
		this.context?.logger.info('No heartbeat ack, resuming');
	}

	async receive(dataStr: string) {
		const data = JSON.parse(dataStr) as SocketMsg;
		this.context!.logger.info("Discord message received: " + dataStr);
		switch (this.wsState) {
			case "initializing": {
				if (data.op === Op.Hello) {
					this.heartbeatInterval = data.d['heartbeat_interval'] as number;
					this.wsState = "running";
					const jitter = this.heartbeatInterval * Math.random();
					let d: number | null = null;
					const sendHeartbeat = () => {
						if (this.ws instanceof WebSocket) {
							if (this.heartbeatAcked === false) {
								this.resume();
							} else {
								try {
									this.ws.send(JSON.stringify({
										op: Op.Heartbeat,
										d
									}));
									this.context?.logger.info(`Heartbeat send ${d}`);
									this.heartbeatAcked = false;
									d = d === null ? 0 : d + 1;
								} catch (err) {
									this.context?.logger.error(`Heartbeat send failed ${err}`);
								}
							}
						}
					}
					// send heartbeats
					setTimeout(() => {
						sendHeartbeat();
						this.intervalId = setInterval(sendHeartbeat, this.heartbeatInterval)
					}, jitter);

					if (this.ws instanceof WebSocket) {
						this.ws.send(JSON.stringify({
							op: Op.Identify,
							d: {
								token: this.token || '',
								intents: intentsNumber(this.receiveIntents),
								properties: {
									os: "linux",
									browser: "restspace",
									device: "restspace"
								}
							}
						}));
						this.wsState = "identifying";
					}
				}
				break;
			}
			case "identifying": {
				if (data.t === "READY") {
					const readyEvent = data.d as unknown as ReadyEvent;
					this.sessionId = readyEvent.session_id as string;
					this.guilds = Object.fromEntries(readyEvent.guilds.map(g => [g.id, null]));
					this.wsState = "running";
				}
				else {
					this.context?.logger.error(`Received wrong event while Identifying: ${JSON.stringify(data)}`);
				}
				break;
			}
			case "running":
				await this.handleDiscordMessage(data);
				break;
		}
	}

	close(ev: any) {
		this.context!.logger.warning(`Discord socket closed: ${ev.code} ${ev.reason}`);
		clearInterval(this.intervalId);
	}

	async handleDiscordMessage(data: SocketMsg) {
		let resp: IIntResponse | null = null;
		switch (data.op || data.t) {
			case Op.HeartbeatAck: {
				this.heartbeatAcked = true;
				return;
			}
			case "INTERACTION_CREATE": {
				resp = await sendTrigger("interaction", data.d, this.triggerUrl!, this.context!);
				break;
			}
			case "MESSAGE_CREATE": {
				await sendTrigger("message", data.d, this.triggerUrl!, this.context!);
				break;
			}
			case "GUILD_CREATE": {
				const guild = data.d;
				const id = guild['id'] as string;
				this.guilds![id] = {
					id,
					botJoined: new Date(guild['joined_at'] as string),
					memberCount: guild['member_count'] as number,
					members: (guild['members'] as any[]).map(m => ({
						id: m.user.id,
						username: m.user.username,
						discriminator: m.user.discriminator,
						locale: m.user.locale,
						verified: m.user.verified,
						email: m.user.email,
						roles: m.roles,
						joinedAt: new Date(m.joined_at),
						pending: m.pending
					} as MemberInfo)),
					channels: (guild['channels'] as any[]).map(c => ({
						id: c.id,
						name: c.name
					} as GuildChannel))
				};
				if (this.guilds![id]!.members.length === 1) this.context!.logger.warning(`Guild ${id} has only one member listed on GUILD_CREATE event. Probably need Presence intent enabled in Discord application config and Restspace config for Discord service.`);
				break;
			}
		}
		if (resp) {
			this.context?.logger.info(`Interaction response: ${JSON.stringify(resp)}`);
			// send interaction response to REST api
			const respMsg = Message.fromSpec(`POST $this /interactions/${data.d.id}/${data.d.token}/callback`, this.context!.tenant, undefined, resp) as Message;
			const respSent = await this.context!.makeProxyRequest!(respMsg);
			if (!respSent.ok) {
				const respData = await respSent.data?.asString();
				this.context!.logger.error(`Error sending interaction response for command ${(data.d.data as any).name}, ${respSent.status} ${respData}`);
			}
		}
	}

	unload() {
		if (this.ws instanceof WebSocket && this.wsState !== "closed") {
			if (this.intervalId) clearInterval(this.intervalId);
			this.ws.close(1000);
			this.wsState = "closed";
		}
		return Promise.resolve();
	}

	
}