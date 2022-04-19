import { Service } from "rs-core/Service.ts";

const service = new Service();

service.postPath('/bypass', msg => {
    return Promise.resolve(msg);
});

export default service;