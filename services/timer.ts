import { Service } from "rs-core/Service.ts";
import { ITriggerServiceConfig } from "rs-core/IServiceConfig.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { BaseStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";
import dayjs from "https://cdn.skypack.dev/dayjs@1.10.4";
import duration from "https://cdn.skypack.dev/dayjs@1.10.4/plugin/duration";
import { Message } from "rs-core/Message.ts";
import { OperationSpec } from "rs-core/DirDescriptor.ts";

dayjs.extend(duration);

interface ITimerConfig extends ITriggerServiceConfig {
    repeatDuration: string; // ISO 8601 duration
    maxRandomAdditionalMs: number;
    autoStart?: boolean;
}

class TimerState extends BaseStateClass {
    paused = false;
    ended = false;
    count = 0;
    timeout?: number;

    private getNextRun(lastRun: any, config: ITimerConfig) {
        const repeatDuration = dayjs.duration(config.repeatDuration);
        const repeatMs = repeatDuration.asMilliseconds();
        const maxRandomAdditionalMs = config.maxRandomAdditionalMs || 0;
        const nextRun = lastRun.add(repeatMs + Math.floor(Math.random() * maxRandomAdditionalMs), "ms");
        return nextRun;
    }

    private async runLoop(context: SimpleServiceContext, config: ITimerConfig) {
        let nextRun = this.getNextRun(dayjs(), config);
        if (!config.autoStart) this.paused = true;
        while (!this.ended) {
            const delayMs = nextRun.diff(dayjs(), "ms");
            await new Promise((resolve) => this.timeout = setTimeout(resolve, delayMs)); // 'this' refers to TimerState instance
            if (!this.paused && !this.ended) {
                const data = {
                    name: config.name,
                    count: this.count++
                }
                const msg = new Message(config.triggerUrl, context, "POST").setDataJson(data);
                const resp = await context.makeRequest(msg);
                if (!resp.ok) context.logger.error(`Timer ${config.name} trigger failed: ${resp.status} ${await resp.data?.asString()}`)
            }
            nextRun = this.getNextRun(nextRun, config);
        }
    }

    load(context: SimpleServiceContext, config: ITimerConfig) {
        this.runLoop(context, config);
        return Promise.resolve();
    }

    unload(_newState?: BaseStateClass | undefined): Promise<void> {
        this.ended = true;
        if (this.timeout) clearTimeout(this.timeout);
        return Promise.resolve();
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