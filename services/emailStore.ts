import { Service } from "rs-core/Service.ts";
import { ITriggerServiceConfig } from "rs-core/IServiceConfig.ts";
import { Email, emailSchema, IEmailStoreAdapter } from "../../rs-core/adapter/IEmailStoreAdapter.ts";
import { ServiceContext, TimedActionState } from "rs-core/ServiceContext.ts";
import { ITimerConfig } from "rs-core/ServiceContext.ts";
import dayjs from "npm:dayjs";
import { Message } from "rs-core/Message.ts";

interface EmailStoreConfig extends ITriggerServiceConfig, ITimerConfig {
    pollIntervalSeconds: number;
}

interface EmailStoreStateData {
    fetchFromDate: string;
    excludeIds?: number[];
}

class EmailStoreState extends TimedActionState<ServiceContext<IEmailStoreAdapter>> {
    override async action(context: ServiceContext<IEmailStoreAdapter>, config: EmailStoreConfig) {
        const stateData = await this.getStore('state-data') as unknown as EmailStoreStateData;
        const fetchFromDate = typeof stateData !== 'number'
            ? new Date(stateData.fetchFromDate)
            : dayjs().subtract(7, 'day').startOf('day').toDate();
        const excludeIds = stateData.excludeIds || [];

        let mostRecentDate = fetchFromDate;
        let emailCount = 0;
        let mostRecentIds = [ ...excludeIds ];

        try {
            const emailIterator = (context.adapter as IEmailStoreAdapter).fetchEmails(fetchFromDate, undefined, excludeIds);
            
            while (true) {
                const { value: email, done } = await emailIterator.next();
                if (done) break;
                
                emailCount++;
                if (email.date.toISOString() === mostRecentDate.toISOString()) {
                    mostRecentIds.push(email.mailboxId);
                    context.logger.info(`New equally recent email added: ${email.mailboxId} ${email.date}`);
                } else if (email.date > mostRecentDate) {
                    mostRecentDate = email.date;
                    mostRecentIds = [email.mailboxId];
                    context.logger.info(`New most recent email: ${email.mailboxId} ${email.date}`);
                }
                
                const msg = new Message(config.triggerUrl, context, "POST").setDataJson(email);
                const resp = await context.makeRequest(msg);
                if (!resp.ok) {
                    context.logger.error(`Email trigger ${config.name} failed: ${resp.status} ${await resp.data?.asString()}`);
                }
            }

            if (emailCount > 0) {
                context.logger.info(`Fetched ${emailCount} emails from ${fetchFromDate}`);
            }
        } catch (error) {
            context.logger.error(`Error processing emails: ${error}`);
        } finally {
            await this.setStore('state-data', {
                fetchFromDate: mostRecentDate.toISOString(),
                excludeIds: mostRecentIds
            });
        }
    }
}

const service = new Service<IEmailStoreAdapter, EmailStoreConfig>();

service.initializer(async (context, config) => {
	await context.state(EmailStoreState, context, config);
});

service.getPath('folders', async (msg, context) => {
    const folders = await context.adapter.listFolders();
    return msg.setDataJson(folders);
});

service.post(async (msg, context) => {
    if (msg.url.servicePathElements.length < 1) {
        return msg.setStatus(400, "POST must be in form /<folder>/");
    }
    const folder = msg.url.servicePath;

    const email = await msg.data?.asJson() as Email;
    if (!email) {
        return msg.setStatus(400, "Missing email body");
    }
    if (!email.charset) {
        email.charset = 'utf-8';
    }
    if (typeof email.date === 'string') {
        email.date = new Date(email.date);
    }
    let flags = [] as string[];
    const flagsQuery = msg.url.query['flags'][0];
    if (flagsQuery) {
        flags = msg.url.query['flags'][0]?.split(',');
        flags = flags.map(flag => flag.trim()).map(flag => flag.startsWith('\\') ? flag : '\\' + flag);
    }

    const result = await context.adapter.writeEmailToFolder(email, folder, flags);
    if (result !== 0) {
        return msg.setStatus(result, "Failed to write email to folder");
    }   

    return msg;
}, emailSchema);

export default service;