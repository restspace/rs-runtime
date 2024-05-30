import { Service } from "rs-core/Service.ts";
import { ITriggerServiceConfig } from "rs-core/IServiceConfig.ts";
import { BaseStateClass, MultiStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";
import dayjs from "https://cdn.skypack.dev/dayjs@1.10.4";
import duration from "https://cdn.skypack.dev/dayjs@1.10.4/plugin/duration";
import { Message } from "rs-core/Message.ts";
import { DirectorySpec, OperationSpec, ViewSpec } from "rs-core/DirDescriptor.ts";
import { Url } from "rs-core/Url.ts";
import { pathCombine } from "rs-core/utility/utility.ts";
import { DirDescriptor } from "rs-core/DirDescriptor.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";

dayjs.extend(duration);

interface ITimerConfig {
    name: string; // Name of the timer
    repeatDuration: string; // ISO 8601 duration of the base interval
    maxRandomAdditionalMs: number; // Adds a random additional interval from 0 to this value ms
    maxRepeats?: number; // If present, limits the number of triggers to this number, then pauses
    repeatUntil?: string; // Any parseable date time by DayJs. Automatically pauses at this time.
    autoStart?: boolean; // If present and true, the timer starts as soon as Restspace boots.
    triggerUrl: string; // URL to trigger
}

const validateSpec = (spec: ITimerConfig) => {
    const errors: string[] = [];
    if (!spec.triggerUrl) errors.push('No trigger url');
    const repeatMs = dayjs.duration(spec.repeatDuration).asMilliseconds();
    if (isNaN(repeatMs)) errors.push('Invalid repeatDuration: ' + spec.repeatDuration);
    if (spec.repeatUntil) {
        const repeatUntil = dayjs(spec.repeatUntil).asMilliseconds();
        if (isNaN(repeatUntil)) errors.push('Invalid repeatUntil ' + spec.repeatUntil);
    }
    return errors.join('; ');
}

class TimerState extends BaseStateClass {
    paused = false;
    ended = false;
    count = 0;
    timeout?: number;
    _config?: ITimerConfig;
    context?: SimpleServiceContext;

    get config() {
        return this._config;
    }
    set config(config: ITimerConfig | undefined) {
        if (!config) return;
        if (this._config && this.context && !this.ended) {
            if (config.repeatDuration !== this._config.repeatDuration) {
                this.restart();
            }
            if (config.maxRepeats && config.maxRepeats < this.count) {
                this.stop();
            }
            if (config.repeatUntil && dayjs(config.repeatUntil).isBefore(dayjs())) {
                this.stop();
            }
        }
        if (config) this._config = config;
    }

    private getNextRun(lastRun: any, config: ITimerConfig) {
        const repeatDuration = dayjs.duration(config.repeatDuration);
        const repeatMs = repeatDuration.asMilliseconds();
        const maxRandomAdditionalMs = config.maxRandomAdditionalMs || 0;
        const nextRun = lastRun.add(repeatMs + Math.floor(Math.random() * maxRandomAdditionalMs), "ms");
        return nextRun;
    }

    private async runLoop(context: SimpleServiceContext) {
        let nextRun = this.getNextRun(dayjs(), this._config!);
        if (!this._config!.autoStart) this.paused = true;
        while (!this.ended) {
            // wait until nextRun (datetime)
            const delayMs = nextRun.diff(dayjs(), "ms");
            await new Promise((resolve) => this.timeout = setTimeout(resolve, delayMs)); // 'this' refers to TimerState instance

            if (!this.paused && !this.ended) {
                const data = {
                    name: this._config!.name,
                    count: this.count++
                }
                const msg = new Message(this._config!.triggerUrl, context, "POST").setDataJson(data);
                const resp = await context.makeRequest(msg);
                if (!resp.ok) context.logger.error(`Timer ${this._config!.name} trigger failed: ${resp.status} ${await resp.data?.asString()}`)
            }
            nextRun = this.getNextRun(nextRun, this._config!);
        }
    }

    stop() {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = undefined
        this.ended = true;
    }

    restart() {
        if (!this.ended) return;
        this.stop();
        this.ended = false;
        this.paused = false;
        this.count = 0;
        this.runLoop(this.context!);
    }

    load(context: SimpleServiceContext, config: ITimerConfig) {
        this._config = config;
        this.context = context;
        this.runLoop(context);
        return Promise.resolve();
    }

    unload(_newState?: BaseStateClass | undefined): Promise<void> {
        this.stop();
        return Promise.resolve();
    }
}

class TimerStoreState extends MultiStateClass<TimerState, ITimerConfig> {
    private async getSpecs(context: SimpleServiceContext, config: IServiceConfig) {
        const getDirMsg = new Message(config.basePath + '/', context, "GET");
        const filesResp = await context.makeRequest(getDirMsg);
        if (!filesResp.ok) {
            context.logger.error('Failed to get timer directory: ' + filesResp.status + ' ' + await filesResp.data?.asString());
            return;
        }
        const files = await filesResp.data?.asJson() as string[];
        await Promise.all(files.map(async (file) => {
            const msg = new Message(pathCombine(config.basePath, file), context, "GET");
            const spec = await context.makeRequest(msg).then(msg => msg.data?.asJson());
            if (!spec) {
                context.logger.error('Failed to get timer spec: ' + msg.status + ' ' + await msg.data?.asString());
                return;
            }
            const validate = validateSpec(spec);
            if (validate) {
                context.logger.error('Invalid timer spec: ' + validate);
                return;
            }
            const substate = this.substate(file, TimerState, spec);
            await substate.load(context, spec);
        }));
    }

    async load(context: SimpleServiceContext, config: IServiceConfig) {
        // don't await this as it needs to make reentrant requests to this service
        // which won't be available until this method completes
        this.getSpecs(context, config);
    }

    async unload(_newState?: BaseStateClass | undefined): Promise<void> {
        await Promise.all(
            Object.values(this.states).map((state) => state.unload())
        );
    }
}

const service = new Service();

const getSpec = async (msg: Message, context: SimpleServiceContext): Promise<[ITimerConfig, Url] | number> => {
    const reqSpec = msg.copy().setMethod("GET");
	const msgSpec = await context.makeRequest(reqSpec);
	if (!msgSpec.ok) return msgSpec.status;
	const spec = await msgSpec.data!.asJson() as ITimerConfig;
	if (!spec) return 400;
    const specUrl: Url = msg.url.copy();
	specUrl.setSubpathFromUrl(msgSpec.getHeader('location') || '');
    return [spec, specUrl];
}

service.initializer(async (context, config) => {
	await context.state(TimerStoreState, context, config);
});

service.post(async (msg, context, config) => {
    if (msg.url.servicePathElements.length !== 2) return msg;
    const getSpecMsg = msg.copy();
    getSpecMsg.url.pathElements.pop();
    const specResult = await getSpec(getSpecMsg, context);
    if (typeof specResult === 'number') return msg.setStatus(specResult);
    const [spec] = specResult;
    const storeState = await context.state(TimerStoreState, context, config);
    const [timer, operation] = msg.url.servicePathElements;
    const state = storeState.substate(timer, TimerState, spec);
    switch (operation) {
        case 'start': state.paused = false; break;
        case 'pause': state.paused = true; break;
        case 'stop': state.stop(); break;
    }
    return msg.setStatus(200); // stops the store handling the message
});

service.get(async (msg, context, config) => {
    if (msg.url.servicePathElements.length !== 2) return msg;
    const getSpecMsg = msg.copy();
    getSpecMsg.url.pathElements.pop();
    const specResult = await getSpec(getSpecMsg, context);
    if (typeof specResult === 'number') return msg.setStatus(specResult);
    const [spec] = specResult;
    const storeState = await context.state(TimerStoreState, context, config);
    const [timer, operation] = msg.url.servicePathElements;
    const state = storeState.substate(timer, TimerState, spec);
    switch (operation) {
        case 'status': return msg.setDataJson({
            paused: state.paused,
            ended: state.ended,
            count: state.count
        }).setStatus(200);
        case 'config': return msg.setDataJson(state.config).setStatus(200);
    }
    return msg.setStatus(200); // stops the store handling the message
});

service.put(async (msg, context, config) => {
    if (msg.url.servicePathElements.length !== 1) return msg;

    const newSpec = await msg.data?.asJson() as ITimerConfig;
    const validate = validateSpec(newSpec);
    if (validate) return msg.setStatus(400, validate);
    const storeState = await context.state(TimerStoreState, context, config);
    const state = storeState.substate(msg.url.servicePathElements[0], TimerState, newSpec);
    state.config = newSpec;
    return msg;
});

service.getDirectory(async (msg, context) => {
    if (msg.url.servicePathElements.length === 0) {
        const dirUrl = msg.url.copy();
        dirUrl.path = '*store/';
        dirUrl.isRelative = true;
        const dirMsg = new Message(dirUrl, context, 'GET');
        const res = await context.makeRequest(dirMsg);
        if (!res.ok) return res;
        const dirSpec = await res.data?.asJson() as DirDescriptor;
        if (dirSpec.paths) {
            dirSpec.paths = dirSpec.paths.map(([path]) => [ path + '/' ]);
        }
        res.setDataJson(dirSpec, "inode/directory+json");
        res.data!.wasMimeHandled = true;
        return res; // get directory from store
    }
    // all timers have directory of operations
    const getSpecMsg = msg.copy();
    getSpecMsg.url.servicePath = msg.url.servicePath.slice(0, -1); // de-directory
    const specResult = await getSpec(getSpecMsg, context);
    if (typeof specResult === 'number') return msg.setStatus(specResult);
    const [, specUrl] = specResult;
    msg.setDataJson({
        path: specUrl.servicePath + '/',
        paths: [ 
            [ 'start', 0, { pattern: "operation" } as OperationSpec ],
            [ 'pause', 0, { pattern: "operation" } as OperationSpec ],
            [ 'stop', 0, { pattern: "operation" } as OperationSpec ],
            [ 'status', 0, { pattern: "view" } as ViewSpec ],
            [ 'config', 0, { pattern: "view" } as ViewSpec ]
        ],
        spec: {
            pattern: "store-directory",
            createFiles: false,
            createDirectory: false,
            storeMimeTypes: [ `application/json; schema="${msg.url.baseUrl()}/.schema.json"` ]
        }
    } as DirDescriptor, "inode/directory+json");
    return msg;
});

export default service;