import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { SimpleServiceContext } from "../../rs-core/ServiceContext.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";

class State {
	constructor() { }
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

service.get((msg: Message, context: SimpleServiceContext, config: IServiceConfig) => {
	if (msg.websocket) {
		const websocket = msg.websocket;
		websocket.onopen = () => service.state(State, context, config).addSocket(msg.url.servicePath, websocket);
		websocket.onclose = () => service.state(State, context, config).removeSocket(msg.url.servicePath, websocket);
		websocket.onmessage = (ev) => onIncoming(ev, context);
	}
	return Promise.resolve(msg);
});

export default service;