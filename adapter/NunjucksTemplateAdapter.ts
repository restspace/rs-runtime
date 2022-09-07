import { ITemplateAdapter } from "rs-core/adapter/ITemplateAdapter.ts";
import nunjucks from "https://deno.land/x/nunjucks@3.2.3/mod.js";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Environment } from "https://deno.land/x/nunjucks@3.2.3/src/environment.js";
import { Message } from "../../rs-core/Message.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { IAuthUser } from "../../rs-core/user/IAuthUser.ts";
import dayjs from "https://cdn.skypack.dev/dayjs@1.10.4";

interface LoaderRes {
    src: string;
    path: string;
    noCache?: boolean;
}

class RestspaceLoader {
    async = true;

    constructor(public context: AdapterContext) {
    }

    getSource(name: string, cb: (err: Error | null, res: LoaderRes | null) => void) {
        const msg = new Message(name, this.context.tenant, "GET");
        this.context.makeRequest(msg)
            .then(res => {
                if (!res.ok) {
                    res.data?.asString()
                        .then(s => cb(new Error(`${res.status} ${s}`), null));
                } else {
                    res.data?.asString()
                        .then(s => cb(null, {
                            src: s || '',
                            path: name
                        }));
                }
            });
    }
}

class NunjucksTemplateAdapter implements ITemplateAdapter {
    env: Environment;

    constructor(public context: AdapterContext) {
        this.env = new nunjucks.Environment(new RestspaceLoader(context));
        this.env.addGlobal('$this', function(this: any) { return this.ctx; });
        this.env.addFilter("dateFormat", (dateStr: string, format: string) => {
            if (dateStr === undefined || dateStr === null) return '';
            return dayjs(dateStr).format(format)
        });
        this.env.addFilter("authorizedFor", (user: IAuthUser, roles: string) => {
            return new AuthUser(user).authorizedFor(roles);
        });
    }

    fillTemplate(data: any, template: string): Promise<string> {
        return new Promise<string>((resolve) => {
            this.env.renderString(template, data, (err: Error, res: string) => {
                if (err) {
                    resolve('error');
                } else {
                    resolve(res);
                }
            });
        });
    }
}

export default NunjucksTemplateAdapter;