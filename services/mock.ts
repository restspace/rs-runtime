import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
export class MockHandler {
    subhandlers: { [ path: string ]: (msg: Message) => Promise<Message> } = {};

    handle(msg: Message): Promise<Message> {
        const pathIdx = '/' + msg.url.servicePath;
        const subhandler = this.subhandlers[pathIdx];
        if (subhandler !== undefined) {
            return new Promise(res => setTimeout(() => res(this.subhandlers[pathIdx](msg)), 1));
        } else {
            return new Promise(res => setTimeout(() => res(msg.setStatus(404, 'Not found')), 2));
        }
    }

    getString(path: string, response: string) {
        this.subhandlers[path] = (msg: Message) => Promise.resolve(msg.setData(response, "text/plain"));
    }

    getStringDelay(path: string, delayMs: number, response: string) {
        this.subhandlers[path] = (msg: Message) => 
            new Promise(res => setTimeout(() => res(msg.setData(response, "text/plain")), delayMs));
    }

    getJson(path: string, obj: unknown) {
        this.subhandlers[path] = (msg: Message) => Promise.resolve(msg.setDataJson(obj));
    }

    getError(path: string, code: number, message: string) {
        this.subhandlers[path] = (msg: Message) => Promise.resolve(msg.setStatus(code, message));
    }

    getNoBody(path: string) {
        this.subhandlers[path] = (msg: Message) => {
            msg.data = undefined;
            return Promise.resolve(msg);
        }
    }
}

export const mockHandler = new MockHandler();

const service = new Service();

service.all((msg: Message) => mockHandler.handle(msg));

export default service;