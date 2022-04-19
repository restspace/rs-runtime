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

const service = new Service();

service.get((msg: Message, context: SimpleServiceContext, config: IServiceConfig) => {
	if (msg.websocket) {
		const websocket = msg.websocket;
		msg.websocket.onopen = () => service.state(State, context, config).addSocket(msg.url.servicePath, websocket);
		msg.websocket.onclose = () => service.state(State, context, config).removeSocket(msg.url.servicePath, websocket);
		//msg.websocket.
	}
	return Promise.resolve(msg);
});

export default service;