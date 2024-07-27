import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { BaseStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";

class State extends BaseStateClass {
	pathSockets: Record<string, WebSocket[]> = {};

	addSocket(path: string, socket: WebSocket) {
		if (this.pathSockets[path] === undefined) {
			this.pathSockets[path] = [ socket ];
		} else {
			this.pathSockets[path].push(socket);
		}
	}

	removeSocket(path: string, socket: WebSocket) {
		const pos = this.pathSockets[path].findIndex(v => v === socket);
		this.pathSockets[path].splice(pos, 1);
		if (this.pathSockets[path].length === 0) {
			delete this.pathSockets[path];
		}
	}
}

const onIncoming = async (ev: MessageEvent<any>, context: SimpleServiceContext) => {
	const msg = Message.fromUint8Array(new Uint8Array(ev.data), context.tenant);
	const msgOut = await context.makeRequest(msg);
	return msgOut;
};

const service = new Service();

service.get(async (msg, context, config) => {
	if (msg.websocket) {
		const websocket = msg.websocket;
		const state = await context.state(State, context, config);
		websocket.onopen = () => state.addSocket(msg.url.servicePath, websocket);
		websocket.onclose = () => state.removeSocket(msg.url.servicePath, websocket);
		websocket.onmessage = (ev) => onIncoming(ev, context);
	}
	return Promise.resolve(msg);
});

service.post(async (msg, context, config) => {
	const sockets = (await context.state(State, context, config)).pathSockets[msg.url.servicePath];
	if (!sockets) return msg.setStatus(404, "No sockets found");
	const msgData = await msg.data?.asArrayBuffer();
	if (!msgData) return msg.setStatus(400, "No data to send to sockets");
	sockets.forEach(s => s.send(msgData));
	return msg;
});

export default service;