import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
export class MockHandler {
    subhandlers: { [ path: string ]: (msg: Message) => Promise<Message> } = {};

    handle(msg: Message): Promise<Message> {
        const pathIdx = '/' + msg.url.servicePath;
        const subhandler = this.subhandlers[pathIdx];
        if (subhandler !== undefined) {
            return this.subhandlers[pathIdx](msg);
        } else {
            return Promise.resolve(msg.setStatus(404, 'Not found'));
        }
    }

    getString(path: string, response: string) {
        this.subhandlers[path] = (msg: Message) => Promise.resolve(msg.setData(response, "text/plain"));
    }

    getJson(path: string, obj: unknown) {
        this.subhandlers[path] = (msg: Message) => Promise.resolve(msg.setDataJson(obj));
    }

    getError(path: string, code: number, message: string) {
        this.subhandlers[path] = (msg: Message) => Promise.resolve(msg.setStatus(code, message));
    }
}

export const mockHandler = new MockHandler();

const service = new Service();

service.all((msg: Message) => mockHandler.handle(msg));

export default service;