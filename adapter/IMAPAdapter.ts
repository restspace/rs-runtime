import { Email, IEmailFetchAdapter } from "rs-core/adapter/IEmailFetchAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";

export interface IMAPAdapterProps {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
}

export default class IMAPAdapter implements IEmailFetchAdapter {
    private tagCounter = 0;
    private connection: Deno.Conn | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    constructor(public context: AdapterContext, public props: IMAPAdapterProps) {
        if (!props.host || !props.port || !props.user || !props.password) {
            throw new Error('Must supply host, port, user and password for IMAP connection');
        }
    }

    private async connect(): Promise<void> {
        const options: Deno.ConnectOptions = {
            hostname: this.props.host,
            port: this.props.port,
            transport: "tcp"
        };

        if (this.props.secure) {
            this.connection = await Deno.connectTls(options);
        } else {
            this.connection = await Deno.connect(options);
        }

        this.reader = this.connection.readable.getReader();
        this.writer = this.connection.writable.getWriter();

        // Wait for greeting
        await this.readResponse();
    }

    private async login(): Promise<void> {
        await this.sendCommand(`LOGIN "${this.props.user}" "${this.props.password}"`);
        await this.readResponse();
    }

    private async select(folder: string): Promise<void> {
        await this.sendCommand(`SELECT "${folder}"`);
        await this.readResponse();
    }

    private async search(since: Date): Promise<number[]> {
        const dateStr = since.toISOString().split('T')[0];
        await this.sendCommand(`SEARCH SINCE "${dateStr}"`);
        const response = await this.readResponse();
        
        // Parse search results
        const match = response.match(/\* SEARCH (.*)/);
        if (!match) return [];
        
        return match[1].split(' ').map(Number).filter(n => !isNaN(n));
    }

    private async fetch(seq: number): Promise<string> {
        await this.sendCommand(`FETCH ${seq} (RFC822)`);
        const response = await this.readResponse();
        
        // Extract message content between * FETCH and the next response
        const match = response.match(/\* \d+ FETCH \(RFC822 \{(\d+)\}\r\n(.*?)\r\n\d+ OK/);
        if (!match) return '';
        
        return match[2];
    }

    private async sendCommand(command: string): Promise<void> {
        const tag = `A${++this.tagCounter}`;
        const fullCommand = `${tag} ${command}\r\n`;
        
        const encoder = new TextEncoder();
        await this.writer?.write(encoder.encode(fullCommand));
    }

    private async readResponse(): Promise<string> {
        const decoder = new TextDecoder();
        let response = '';
        
        while (true) {
            const { done, value } = await this.reader?.read() || { done: true, value: null };
            if (done) break;
            
            response += decoder.decode(value);
            if (response.includes('\r\n')) break;
        }
        
        return response;
    }

    private parseEmail(rfc822: string): Email {
        const lines = rfc822.split('\r\n');
        const headers: Record<string, string> = {};
        let body = '';
        let inBody = false;

        for (const line of lines) {
            if (line === '') {
                inBody = true;
                continue;
            }

            if (!inBody) {
                const [key, ...values] = line.split(':');
                if (key && values.length > 0) {
                    headers[key.toLowerCase()] = values.join(':').trim();
                }
            } else {
                body += line + '\n';
            }
        }

        return {
            id: headers['message-id'] || '',
            from: headers['from'] || '',
            to: headers['to'] || '',
            date: new Date(headers['date'] || ''),
            subject: headers['subject'] || '',
            body: body.trim()
        };
    }

    async fetchEmails(folder: string, since: Date): Promise<Email[]> {
        try {
            await this.connect();
            await this.login();
            await this.select(folder);
            
            const messageIds = await this.search(since);
            const emails: Email[] = [];
            
            for (const id of messageIds) {
                const rfc822 = await this.fetch(id);
                if (rfc822) {
                    emails.push(this.parseEmail(rfc822));
                }
            }
            
            return emails;
        } catch (error) {
            this.context.logger.error('Error fetching emails:', error);
            throw error;
        } finally {
            try {
                if (this.connection) {
                    await this.sendCommand('LOGOUT');
                    await this.readResponse();
                    this.connection.close();
                }
            } catch (error) {
                this.context.logger.warning('Error closing IMAP connection:', error);
            }
        }
    }
}