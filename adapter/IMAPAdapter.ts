import { Email, IEmailFetchAdapter } from "rs-core/adapter/IEmailFetchAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import dayjs from "dayjs";

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
        const dateStr = dayjs(since).format('DD-MMM-YYYY');
        
        await this.sendCommand(`SEARCH SINCE ${dateStr}`);
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
        const match = response.match(/\* \d+ FETCH \(RFC822 \{(\d+)\}\r\n([\s\S]*?)\r\nA\d+ OK/);
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
        if (!this.reader) {
            throw new Error('IMAP connection reader is not initialized');
        }

        const decoder = new TextDecoder();
        let response = '';
        
        try {
            while (true) {
                const { done, value } = await this.reader.read();
                if (done) {
                    this.context.logger.debug('IMAP connection closed by server');
                    break;
                }
                
                response += decoder.decode(value);
                this.context.logger.debug(`Received IMAP response: ${response}`);
                
                // For FETCH responses, we need to read until we get a tagged response (A1, A2, etc.)
                if (response.match(/A\d+ (OK|NO|BAD|BYE)/)) break;
                
                // For other responses, we can stop at \r\n
                if (response.endsWith('\r\n')) break;
            }
            
            if (!response) {
                throw new Error('No response received from IMAP server');
            }
            
            return response;
        } catch (error) {
            this.context.logger.error('Error reading IMAP response:', error);
            throw error;
        }
    }

    private parseEmail(rfc822: string): Email {
        const lines = rfc822.split('\r\n');
        const headers: Record<string, string> = {};
        let body = '';
        let inBody = false;
        let currentHeader = '';
        let currentValue = '';
        let contentType = 'text/plain';
        let charset = 'utf-8';
        let boundary = '';

        for (const line of lines) {
            if (line === '') {
                inBody = true;
                continue;
            }

            if (!inBody) {
                // Check if this is a continuation line (starts with whitespace)
                if (line.startsWith(' ') || line.startsWith('\t')) {
                    if (currentHeader) {
                        currentValue += ' ' + line.trim();
                    }
                } else {
                    // Save previous header if exists
                    if (currentHeader && currentValue) {
                        headers[currentHeader.toLowerCase()] = currentValue;
                        
                        // Parse Content-Type header
                        if (currentHeader.toLowerCase() === 'content-type') {
                            const typeMatch = currentValue.match(/([^;]+)/);
                            if (typeMatch) {
                                contentType = typeMatch[1].toLowerCase();
                            }
                            const charsetMatch = currentValue.match(/charset=([^;]+)/i);
                            if (charsetMatch) {
                                charset = charsetMatch[1].toLowerCase();
                            }
                            const boundaryMatch = currentValue.match(/boundary=([^;]+)/i);
                            if (boundaryMatch) {
                                boundary = boundaryMatch[1].replace(/"/g, '');
                            }
                        }
                    }
                    
                    // Start new header
                    const [key, ...values] = line.split(':');
                    if (key && values.length > 0) {
                        currentHeader = key;
                        currentValue = values.join(':').trim();
                    }
                }
            } else {
                body += line + '\n';
            }
        }

        // Save last header if exists
        if (currentHeader && currentValue) {
            headers[currentHeader.toLowerCase()] = currentValue;
        }

        // Parse the body based on content type
        const parsedBody = this.parseBody(body, contentType, boundary, headers);

        return {
            id: headers['message-id'] || '',
            mailboxId: 0,
            from: headers['from'] || '',
            to: headers['to'] || '',
            date: new Date(headers['date'] || ''),
            subject: headers['subject'] || '',
            body: parsedBody.html || parsedBody.text || '',
            contentType: contentType,
            charset: charset,
            textBody: parsedBody.text,
            attachments: parsedBody.attachments
        };
    }

    private parseBody(body: string, contentType: string, boundary: string, headers: Record<string, string>): { 
        text?: string; 
        html?: string; 
        attachments?: Record<string, string> 
    } {
        const result: { text?: string; html?: string; attachments?: Record<string, string> } = {};
        
        if (!boundary) {
            // Simple text or html email
            result.text = contentType === 'text/plain' ? body : undefined;
            result.html = contentType === 'text/html' ? body : undefined;
            return result;
        }

        // Handle multipart emails
        const parts = this.splitMimeParts(body, boundary);
        let attachmentIndex = 0;

        for (const part of parts) {
            const partHeaders = this.parseHeaders(part.headers);
            if (!partHeaders['content-type']) {
                this.context.logger.warning('No content-type found for part:', part.headers);
                continue;
            }
            const partContentType = partHeaders['content-type']?.split(';')[0].toLowerCase();
            const contentDisposition = partHeaders['content-disposition']?.toLowerCase() || '';
            const contentId = partHeaders['content-id']?.replace(/[<>]/g, '') || '';
            const isAttachment = contentDisposition.includes('attachment');
            const isInline = contentDisposition.includes('inline');

            if (partContentType === 'text/plain' && !isAttachment) {
                result.text = part.body;
            } else if (partContentType === 'text/html' && !isAttachment) {
                result.html = part.body;
            } else if (isAttachment || isInline) {
                // Handle attachments
                if (!result.attachments) {
                    result.attachments = {};
                }

                let filename = '';
                const filenameMatch = contentDisposition.match(/filename=([^;]+)/i);
                if (filenameMatch) {
                    filename = filenameMatch[1].replace(/"/g, '');
                }

                if (contentType === 'multipart/related' && contentId) {
                    result.attachments[contentId] = part.body;
                } else {
                    const key = filename || `attachment${++attachmentIndex}`;
                    result.attachments[key] = part.body;
                }
            }
        }

        return result;
    }

    private splitMimeParts(body: string, boundary: string): Array<{ headers: string; body: string }> {
        const parts: Array<{ headers: string; body: string }> = [];
        const boundaryRegex = new RegExp(`--${boundary}(?:--)?`);
        const sections = body.split(boundaryRegex).filter(s => s.trim());

        // Common email header names (case-insensitive)
        const commonHeaders = new Set([
            'content-type', 'content-transfer-encoding', 'content-disposition',
            'content-id', 'content-description', 'content-location',
            'from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date',
            'mime-version', 'message-id', 'references', 'in-reply-to'
        ]);

        for (const section of sections) {
            const lines = section.split(/\r\n|\n/);
            let headerEndIndex = -1;

            // First try to find double newline
            const doubleNewlineIndex = section.includes('\r\n\r\n') ? 
                lines.findIndex((_, i) => i < lines.length - 1 && lines[i] === '' && lines[i + 1] === '') :
                lines.findIndex((_, i) => i < lines.length - 1 && lines[i] === '' && lines[i + 1] === '');

            if (doubleNewlineIndex !== -1) {
                headerEndIndex = doubleNewlineIndex;
            } else {
                // Fall back to checking for first non-header-like line
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line === '') continue;

                    const colonIndex = line.indexOf(':');
                    if (colonIndex === -1 || !commonHeaders.has(line.slice(0, colonIndex).toLowerCase().trim())) {
                        headerEndIndex = i - 1;
                        break;
                    }
                }
            }

            if (headerEndIndex !== -1) {
                const headers = lines.slice(0, headerEndIndex + 1).join('\r\n');
                const body = lines.slice(headerEndIndex + 1).join('\r\n');
                parts.push({
                    headers: headers.trim(),
                    body: body.trim()
                });
            }
        }

        return parts;
    }

    private parseHeaders(headerString: string): Record<string, string> {
        const headers: Record<string, string> = {};
        const lines = headerString.split('\r\n');
        let currentHeader = '';
        let currentValue = '';

        for (const line of lines) {
            if (line.startsWith(' ') || line.startsWith('\t')) {
                if (currentHeader) {
                    currentValue += ' ' + line.trim();
                }
            } else {
                if (currentHeader && currentValue) {
                    headers[currentHeader.toLowerCase()] = currentValue;
                }
                const [key, ...values] = line.split(':');
                if (key && values.length > 0) {
                    currentHeader = key;
                    currentValue = values.join(':').trim();
                }
            }
        }

        if (currentHeader && currentValue) {
            headers[currentHeader.toLowerCase()] = currentValue;
        }

        return headers;
    }

    async *fetchEmails(since: Date, folder: string = "INBOX", excludeIds: number[] = []): AsyncGenerator<Email> {
        try {
            await this.connect();
            await this.login();
            await this.select(folder);
            
            const messageIds = await this.search(since);
            
            for (const id of messageIds) {
                const rfc822 = await this.fetch(id);
                if (rfc822) {
                    const email = this.parseEmail(rfc822);
                    email.mailboxId = id;
                    if (email.date < since || excludeIds.includes(id)) continue;
                    yield email;
                }
            }
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