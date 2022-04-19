import { ITemplateAdapter } from "rs-core/adapter/ITemplateAdapter.ts";
import nunjucks from "https://deno.land/x/nunjucks@3.2.3/mod.js";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";

class NunjucksTemplateAdapter implements ITemplateAdapter {
    constructor(public context: AdapterContext) {
    }

    fillTemplate(data: any, template: string): Promise<string> {
        return Promise.resolve(nunjucks.renderString(template, data));
    }
}

export default NunjucksTemplateAdapter;