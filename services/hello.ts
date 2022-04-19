import { Service } from "rs-core/Service.ts";

const service = new Service();

service.get((msg) => Promise.resolve(msg.setText('hello world')));

export default service;