export enum PipelineAction {
    stop, next, end
}

export class PipelineMode {
    mode: "parallel" | "serial" = "serial";
    fail: PipelineAction = PipelineAction.next;
    succeed: PipelineAction = PipelineAction.next;
    conditional = false;
    tee = false;
    teeWait = false;

    constructor(parentModeOrToken?: PipelineMode | string) {
        if (parentModeOrToken === undefined) return;
        if (parentModeOrToken instanceof PipelineMode) {
            const isParallel = parentModeOrToken.mode === "serial" && !parentModeOrToken.conditional;
            if (isParallel) {
                this.mode = "parallel";
                this.fail = PipelineAction.stop;
            }
        } else if (parentModeOrToken) {
            const parts = parentModeOrToken.split(' ');
            switch (parts[0]) {
                case "parallel":
                    this.mode = "parallel";
                    break;
                case "conditional":
                    this.mode = "serial";
                    this.succeed = PipelineAction.end;
                    this.fail = PipelineAction.next;
                    this.conditional = true;
                    return;
                case "tee":
                    this.mode = "serial";
                    this.tee = true;
                    break;
                case "teeWait":
                    this.mode = "serial";
                    this.tee = true;
                    this.teeWait = true;
                    break;
                default:
                    this.mode = "serial";
                    break;
            }
            if (parts.length > 1) {
                this.fail = (PipelineAction as any)[parts[1]];
            } else if (this.mode === "parallel") {
                this.fail = PipelineAction.stop;
            }
            if (parts.length > 2) this.succeed = (PipelineAction as any)[parts[2]];
            const errors = this.getErrors();
            if (errors.length) throw new Error('Bad pipelne mode: ' + errors.join(','));
        }
    }

    getErrors() {
        const errors: string[] = [];
        if (this.fail === undefined) errors.push('unknown fail mode');
        if (this.succeed === undefined) errors.push('unknown succeed mode');
        if (this.mode === "parallel" && this.fail !== PipelineAction.stop && this.succeed !== PipelineAction.next)
            errors.push("parallel mode must stop on fail and do next on succeed");
        if (this.succeed !== PipelineAction.next && this.fail !== PipelineAction.next)
            errors.push("either succeed or fail must do next or pipeline cannot execute");
        if (this.succeed === PipelineAction.stop)
            errors.push("cannot stop on success or pipeline always fails");
        return errors;
    }

    allowedMidstreamChangeTo(mode: PipelineMode) {
        return this.mode !== 'parallel' && mode.mode !== 'parallel';
    }

    static isValid(token: string) {
        return [ "parallel", "serial", "conditional", "tee", "teeWait" ].includes(token.split(' ')[0]);
    }

    static parallel() {
        const mode = new PipelineMode();
        mode.mode = "parallel";
        return mode;
    }

    toString() {
        if (this.conditional) return "conditional";
        return `${this.mode} ${this.fail} ${this.succeed}`;
    }

    copy() {
        const newMode = new PipelineMode();
        newMode.mode = this.mode;
        newMode.fail = this.fail;
        newMode.succeed = this.succeed;
        newMode.conditional = this.conditional;
        return newMode;
    }
}