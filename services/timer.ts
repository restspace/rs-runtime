import { Service } from "rs-core/Service.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { BaseStateClass, ITimerConfig, SimpleServiceContext, TimedActionState } from "rs-core/ServiceContext.ts";
import dayjs from "npm:dayjs";
import duration from "npm:dayjs/plugin/duration.js";
import { Message } from "rs-core/Message.ts";
import { OperationSpec } from "rs-core/DirDescriptor.ts";

dayjs.extend(duration);

class TimerState extends TimedActionState {
    protected async action(context: SimpleServiceContext, config: ITimerConfig) {
        const data = {
            name: config.name,
            count: this.count++
        };
        const msg = new Message(config.triggerUrl, context, "POST").setDataJson(data);
        const resp = await context.makeRequest(msg);
        if (!resp.ok) context.logger.error(`Timer ${config.name} trigger failed: ${resp.status} ${await resp.data?.asString()}`);
    }
}
const service = new Service<IDataAdapter, ITimerConfig>();

service.initializer(async (context, config) => {
	await context.state(TimerState, context, config);
});

service.postPath('start', async (msg, context, config) => {
    const state = await context.state(TimerState, context, config);
    state.paused = false;
    return msg.setStatus(200);
});
service.postPath('pause', async (msg, context, config) => {
    const state = await context.state(TimerState, context, config);
    state.paused = true;
    return msg.setStatus(200);
});
service.postPath('preempt', async (msg, context, config) => {
    const state = await context.state(TimerState, context, config);
    if (state.timeout) clearTimeout(state.timeout);
    return msg.setStatus(200);
});

service.constantDirectory('/', {
    path: '/',
    paths: [ 
        [ 'start', 0, { pattern: "operation" } as OperationSpec ],
        [ 'pause', 0, { pattern: "operation" } as OperationSpec ],
        [ 'preempt', 0, { pattern: "operation" } as OperationSpec ]
    ],
    spec: {
        pattern: 'directory'
    }
});

export default service;