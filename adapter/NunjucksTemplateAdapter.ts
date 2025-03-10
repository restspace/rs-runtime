import { ITemplateAdapter } from "rs-core/adapter/ITemplateAdapter.ts";
import nunjucks from "https://deno.land/x/nunjucks@3.2.3/mod.js";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { Environment } from "https://deno.land/x/nunjucks@3.2.3/src/environment.js";
import { Message } from "rs-core/Message.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { IAuthUser } from "rs-core/user/IAuthUser.ts";
import dayjs from "npm:dayjs";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";
import { Url } from "rs-core/Url.ts";
import { upTo, after, upToLast, afterLast } from "rs-core/utility/utility.ts";

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
        const msg = new Message(name, this.context.tenant, "GET", null);
        msg.startSpan(this.context.traceparent, this.context.tracestate);
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

    constructor(public context: AdapterContext, public props: Record<string, any>) {
        this.env = new nunjucks.Environment(new RestspaceLoader(context));
        this.env.addGlobal('$this', function(this: any) {
            delete this.ctx['_url'];
            return this.ctx;
        });
        this.env.addFilter("dateFormat", (dateStr: string, format: string) => {
            if (dateStr === undefined || dateStr === null) return '';
            return dayjs(dateStr).format(format)
        });
        this.env.addFilter("authorizedFor", (user: IAuthUser, roles: string) => {
            return new AuthUser(user).authorizedFor(roles);
        });
        this.env.addFilter("pathPattern", function(this: any, pattern: string, decode?: boolean) {
            return resolvePathPatternWithUrl(pattern, this.ctx._url as Url, undefined, undefined, decode);
        });
        this.env.addFilter("upTo", upTo);
        this.env.addFilter("after", after);
        this.env.addFilter("upToLast", upToLast);
        this.env.addFilter("afterLast", afterLast);
        this.env.addFilter("split", (s: string, sep: string) => s.split(sep));
        this.env.addFilter("replaceRegex", (s: string, search: string, replace: string) => s.replace(new RegExp(search), replace));
        this.env.addFilter("substring", (s: string, start: number, end?: number) => s.substring(start, end));
    }

    fillTemplate(data: any, template: string, url: Url): Promise<string> {
        return new Promise<string>((resolve) => {
            this.env.renderString(template,
                {
                    ...data,
                    _url: url
                },
                (err: Error, res: string) => {
                    if (err) {
                        resolve(`template error: ${err}`);
                    } else {
                        resolve(res);
                    }
                }
            );
        });
    }
}

export default NunjucksTemplateAdapter;