import { Email, IEmailFetchAdapter } from "rs-core/adapter/IEmailFetchAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface IMAPAdapterProps {
    url: string;
}

export default class IMAPAdapter implements IEmailFetchAdapter {
    constructor(public context: AdapterContext, public props: IMAPAdapterProps) {
    }

    async fetchEmails(folder: string, since: Date): Promise<Email[]> {
        return [];
    }
}