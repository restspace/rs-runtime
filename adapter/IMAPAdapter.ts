import { Email, IEmailStoreAdapter } from "../../rs-core/adapter/IEmailStoreAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import dayjs from "dayjs";
import { emailRawToObject, objectEmailToRaw } from "../../rs-core/email/emailRawToObject.ts";
import { ImapClient } from "@workingdevshero/deno-imap";


export interface IMAPAdapterProps {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    preemptiveFetch?: boolean;
}

export default class IMAPAdapter implements IEmailStoreAdapter {
    private client: ImapClient;

    constructor(public context: AdapterContext, public props: IMAPAdapterProps) {
        if (!props.host || !props.port || !props.user || !props.password) {
            throw new Error('Must supply host, port, user and password for IMAP connection');
        }
        this.client = new ImapClient({
            host: props.host,
            port: props.port,
            tls: props.secure,
            username: props.user,
            password: props.password
        });
    }

    async *fetchEmails(since: Date, folder: string = "INBOX", excludeIds: number[] = []): AsyncGenerator<Email> {
        this.context.logger.info(`Fetching emails since ${since} from ${folder}, excluding ${excludeIds.join(', ')}`);
        try {
            await this.client.connect();
            await this.client.authenticate();
            await this.client.selectMailbox(folder);
            
            const messageIds = await this.client.search({
                date: {
                    internal: {
                        since
                    }
                }
            });
            this.context.logger.info(`Found ${messageIds.length} messages: ${messageIds.join(', ')}`);
            
            let processedCount = 0;
            const decoder = new TextDecoder('utf-8');
            for (const id of messageIds) {
                this.context.logger.debug(`Processing message ${id} (${processedCount + 1}/${messageIds.length})`);
                
                const emails = await this.client.fetch(id.toString(), { full: true })
                this.context.logger.debug(`Fetch completed for message ${id}`);
                
                if (emails[0]) {
                    const email = emailRawToObject(decoder.decode(emails[0].raw));
                    email.mailboxId = id;
                    if (email.date < since || excludeIds.includes(id)) {
                        this.context.logger.info(`Skipping email ${id} ${email.id} of ${email.date} because it is before ${since} or in the exclude list`);
                        processedCount++;
                        continue;
                    }
                    
                    this.context.logger.info(`Yielding email ${id} ${email.id} of ${email.date} (${processedCount + 1}/${messageIds.length})`);
                    yield email;
                    processedCount++;
                    this.context.logger.debug(`Successfully processed message ${id}`);
                } else {
                    this.context.logger.warning(`No RFC822 data returned for message ${id}`);
                    processedCount++;
                }
            }

            if (this.props.preemptiveFetch && messageIds.length > 0) {
                let lastId = messageIds[messageIds.length - 1] + 1;
                let failed = false;
                while (!failed) {
                    try {
                        this.context.logger.debug(`Preemptively fetching email ${lastId}`);
                        const emails = await this.client.fetch(lastId.toString(), { full: true })
                        if (emails[0]) {
                            const email = emailRawToObject(decoder.decode(emails[0].raw));
                            email.mailboxId = lastId;
                            this.context.logger.debug(`Preemptively fetch successful for email ${lastId}`);
                            yield email;
                        } else {
                            failed = true;
                        }
                        lastId++;
                    } catch (error) {
                        this.context.logger.error('Error fetching email:', error);
                        failed = true;
                    }
                }
            }
            
            this.context.logger.info(`Completed processing ${processedCount}/${messageIds.length} messages`);
        } catch (error) {
            this.context.logger.error('Error fetching emails:', error);
            throw error;
        } finally {
            try {
                if (this.client.connected) {
                    this.client.disconnect();
                }
            } catch (error) {
                this.context.logger.warning('Error closing IMAP connection:', error);
            }
        }
    }

    async writeEmailToFolder(email: Email, folder: string = "OUTBOX", flags: string[] = []): Promise<number> {
        try {
            await this.client.connect();
            await this.client.authenticate();
            
            // Convert email to RFC822 format
            const rfc822 = objectEmailToRaw(email);

            await this.client.appendMessage(folder, rfc822, flags);
            
            return 0;
        } catch (error) {
            this.context.logger.error('Error writing email to folder:', error);
            throw error;
        } finally {
            try {
                if (this.client.connected) {
                    this.client.disconnect();
                }
            } catch (error) {
                this.context.logger.warning('Error closing IMAP connection:', error);
            }
        }
    }

    async listFolders(): Promise<string[]> {
        await this.client.connect();
        await this.client.authenticate();
        const folders = await this.client.listMailboxes();
        return folders.map(folder => folder.name);
    }
}