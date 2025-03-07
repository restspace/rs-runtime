import { Service } from "rs-core/Service.ts";
import { ITriggerServiceConfig } from "rs-core/IServiceConfig.ts";
import { IEmailFetchAdapter } from "rs-core/adapter/IEmailFetchAdapter.ts";
import { ServiceContext, TimedActionState } from "rs-core/ServiceContext.ts";
import { ITimerConfig } from "rs-core/ServiceContext.ts";
import dayjs from "npm:dayjs";
import { Message } from "rs-core/Message.ts";

interface EmailTriggerConfig extends ITriggerServiceConfig, ITimerConfig {
    pollIntervalSeconds: number;
}

interface EmailTriggerStateData {
    fetchFromDate: string;
    excludeIds?: number[];
}

class EmailTriggerState extends TimedActionState<ServiceContext<IEmailFetchAdapter>> {
    override async action(context: ServiceContext<IEmailFetchAdapter>, config: EmailTriggerConfig) {
        const stateData = await this.getStore('state-data') as unknown as EmailTriggerStateData;
        const fetchFromDate = typeof stateData !== 'number'
            ? new Date(stateData.fetchFromDate)
            : dayjs().subtract(2, 'day').startOf('day').toDate();
        const excludeIds = stateData.excludeIds || [];

        let mostRecentDate = fetchFromDate;
        let emailCount = 0;
        let mostRecentIds = excludeIds;

        try {
            const emailIterator = (context.adapter as IEmailFetchAdapter).fetchEmails(fetchFromDate, undefined, excludeIds);
            
            while (true) {
                const { value: email, done } = await emailIterator.next();
                if (done) break;
                
                emailCount++;
                if (email.date.toISOString() === mostRecentDate.toISOString()) {
                    mostRecentIds.push(email.mailboxId);
                } else if (email.date > mostRecentDate) {
                    mostRecentDate = email.date;
                    mostRecentIds = [email.mailboxId];
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

const service = new Service<IEmailFetchAdapter, EmailTriggerConfig>();

service.initializer(async (context, config) => {
	await context.state(EmailTriggerState, context, config);
});

export default service;