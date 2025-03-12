import { Email, IEmailStoreAdapter } from "../../rs-core/adapter/IEmailStoreAdapter.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import dayjs from "dayjs";
import { emailRawToObject, objectEmailToRaw } from "../../rs-core/email/emailRawToObject.ts";
import { asyncHeadParser, asyncSkipBytes, textReaderToAsyncGenerator } from "../../rs-core/streams/streamParse.ts";

export interface IMAPAdapterProps {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
}

export default class IMAPAdapter implements IEmailStoreAdapter {
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
        await this.readConnectResponse();
    }

    private async login(): Promise<void> {
        await this.sendCommand(`LOGIN "${this.props.user}" "${this.props.password}"`);
        await this.readAndIgnore();
    }

    private async select(folder: string): Promise<void> {
        await this.sendCommand(`SELECT "${folder}"`);
        await this.readAndIgnore();
    }

    private async search(since: Date): Promise<number[]> {
        const dateStr = dayjs(since).format('DD-MMM-YYYY');
        
        await this.sendCommand(`SEARCH SINCE ${dateStr}`);
        const sequenceNos = await this.readSearchResponse();
        
        return sequenceNos.split(' ').map(Number).filter(n => !isNaN(n));
    }

    private async fetch(seq: number): Promise<string> {
        await this.sendCommand(`FETCH ${seq} (RFC822)`);
        const data = await this.readFetchResponse();
        
        return data;
    }

    private async sendCommand(command: string): Promise<void> {
        const tag = `A${++this.tagCounter}`;
        const fullCommand = `${tag} ${command}\r\n`;
        
        const encoder = new TextEncoder();
        await this.writer?.write(encoder.encode(fullCommand));
    }

    private async readConnectResponse(): Promise<void> {  
        const res = await asyncHeadParser(this.reader!, '', 0, ['* OK', '\r\n']);
        if (res.matched !== '* OK') {
            throw new Error('IMAP connection failed');
        }
        const res2 = await asyncHeadParser(this.reader!, res.buffer, res.offset, ['\r\n']);
        if (res2.matched !== '\r\n') {
            throw new Error('IMAP connection failed');
        }
    }

    private async readAndIgnore(): Promise<boolean> {
        let buffer = '';
        let offset = 0;
        let matched = '';
        let ok = false;
        while (true) {  
            ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['* ', 'A', 'a']));
            switch (matched) {
                case '* ': {
                    ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
                    if (matched !== '\r\n') {
                        throw new Error('IMAP connection failed');
                    }
                    break;
                }
                case 'A':
                case 'a': {
                    ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['OK', '\r\n']));
                    if (matched == '\r\n') {
                        return false;
                    }
                    ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
                    if (matched !== '\r\n') {
                        throw new Error('IMAP connection failed');
                    }
                    return true;
                }  
            }
        }
    }

    private async readSearchResponse(): Promise<string> {
        let buffer = '';
        let offset = 0;
        let matched = '';
        let result = '';
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['* SEARCH', '\r\n']));
        if (matched !== '* SEARCH') {
            throw new Error('Bad Response from IMAP server');
        }
        const startOffset = offset;
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
        if (matched !== '\r\n') {
            throw new Error('Bad Response from IMAP server');
        }
        result = buffer.slice(startOffset, offset);
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
        if (matched !== '\r\n') {
            throw new Error('Bad Response from IMAP server');
        }
        return result;
    }

    private async readFetchResponse(): Promise<string> {
        let buffer = '';
        let offset = 0;
        let startOffset = 0;
        let matched = '';
        let result = '';
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['FETCH (RFC822 {', '\r\n']));
        if (matched !== '* FETCH') {
            throw new Error('Bad Response from IMAP server');
        }
        startOffset = offset;
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['}', '\r\n']));
        if (matched !== '}') {
            throw new Error('Bad Response from IMAP server');
        }
        result = buffer.slice(startOffset, offset);
        ({buffer, offset, raw: result} = await this.readRaw(buffer, offset));
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
        if (matched !== '\r\n') {
            throw new Error('Bad Response from IMAP server');
        }
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
        if (matched !== '\r\n') {
            throw new Error('Bad Response from IMAP server');
        }
        return result;
    }

    private async readRaw(buffer: string, offset: number): Promise<{buffer: string, offset: number, raw: string}> {
        let startOffset = offset;
        let matched = '';
        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['}', '\r\n']));
        if (matched !== '}') {
            throw new Error('Bad Response from IMAP server');
        }
        const len = parseInt(buffer.slice(startOffset, offset));
        startOffset = offset;
        ({buffer, offset} = await asyncSkipBytes(this.reader!, buffer, offset, len));
        return {buffer, offset, raw: buffer.slice(startOffset, offset)};
    }

    private async readContinuation(): Promise<void> {
        let buffer = '';
        let offset = 0;
        let matched = '';

        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['+ ', '\r\n']));
        if (matched !== '+ ') {
            throw new Error('Expected IMAP continuation response but received something else');
        }

        ({matched, buffer, offset} = await asyncHeadParser(this.reader!, buffer, offset, ['\r\n']));
        if (matched !== '\r\n') {
            throw new Error('Malformed IMAP continuation response');
        }
    }

    private async readResponse(): Promise<string> {
        if (!this.reader) {
            throw new Error('IMAP connection reader is not initialized');
        }

        const decoder = new TextDecoder('utf-8');
        const encoder = new TextEncoder();
        let response = '';
        let literalBytesRemaining = 0;
        let parenthesesCount = 0;
        let checkFromPos = 0;
        let partialLiteralCount = '';
        
        try {
            while (true) {
                let result = null as null | ReadableStreamReadResult<Uint8Array>;
                try {
                    result = await Promise.race([
                        this.reader.read(),
                        new Promise<null>((_, reject) => setTimeout(() => { reject(new Error('read timeout')); }, 20000))
                    ]);
                } catch (err) {
                    if (err instanceof Error && err.message === 'read timeout') {
                        this.reader.cancel();
                    }
                    throw err;
                }

                if (result === null) {
                    // assume we didn't detect the messsage end, if something else happened it generates an error parsing the response
                    return response;
                }

                const { done, value } = result;
                if (done) {
                    this.context.logger.debug('IMAP connection closed by server');
                    break;
                }

                let postLiteralLength = 0;
                if (literalBytesRemaining > 0) {
                    const len = Math.min(literalBytesRemaining, value.length);
                    if (len < value.length) {
                        postLiteralLength = decoder.decode(value.slice(len)).length;
                    }
                    literalBytesRemaining -= len;
                }
                
                const chunk = decoder.decode(value, { stream: true }); // Use streaming mode for multi-chunk decoding
                response += chunk;

                if (literalBytesRemaining > 0) {
                    continue;
                } else if (postLiteralLength > 0) {
                    checkFromPos = response.length - postLiteralLength;
                }

                const scanStart = postLiteralLength > 0 ? chunk.length - postLiteralLength : 0;
                for (let i = scanStart; i < chunk.length; i++) {
                    const char = chunk[i];
                    if (char === '(') parenthesesCount++;
                    if (char === ')') parenthesesCount--;
                    if (char === '{') {
                        const literalEnd = chunk.indexOf('}', i);
                        if (literalEnd < 0) {
                            partialLiteralCount = chunk.slice(i + 1);
                        } else {
                            literalBytesRemaining = parseInt(chunk.slice(i + 1, literalEnd));
                            const remainingLiteralBytes = encoder.encode(chunk.slice(literalEnd + 1));
                            literalBytesRemaining -= remainingLiteralBytes.length;
                            if (literalBytesRemaining <= 0) {
                                i += decoder.decode(remainingLiteralBytes.slice(0, remainingLiteralBytes.length - literalBytesRemaining)).length;
                                checkFromPos = response.length - chunk.length + i;
                            } else {
                                break;
                            }
                        }
                    }
                    if (char === '}') {
                        if (partialLiteralCount) {
                            literalBytesRemaining = parseInt(partialLiteralCount + chunk.slice(0, i))
                            partialLiteralCount = '';
                            const remainingLiteralBytes = encoder.encode(chunk.slice(i + 1));
                            literalBytesRemaining -= remainingLiteralBytes.length;
                            if (literalBytesRemaining <= 0) {
                                i += decoder.decode(remainingLiteralBytes.slice(0, remainingLiteralBytes.length - literalBytesRemaining)).length;
                                checkFromPos = response.length - chunk.length + i;
                            }
                        }
                    }
                }

                if (partialLiteralCount !== '' || literalBytesRemaining > 0 || parenthesesCount > 0) {
                    continue;
                }
                
                // Check if we have a complete response
                const isComplete = this.isResponseComplete(checkFromPos, response);
                
                if (isComplete) {
                    this.context.logger.debug(`Complete response received: ${response.length} bytes`);
                    break;
                }
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

    // Helper method to check if a response is complete
    private isResponseComplete(checkFromPos: number, response: string): boolean {
        // Check for different types of complete responses:
        const checkString = response.slice(checkFromPos);

        // 1. Tagged response (e.g., "A1 OK FETCH completed")
        if (checkString.match(/^A\d+ (OK|NO|BAD|BYE)/m) && checkString.match(/\r\n$/)) return true;
        
        // 2. Server greeting
        if (checkString.match(/^\* (OK|PREAUTH|BYE)/) && checkString.match(/\r\n$/)) return true;
        
        // 3. Untagged response for simple commands (CAPABILITY, NAMESPACE, etc.)   
        if (checkString.match(/^\* [A-Z]+ /) && checkString.match(/\r\n$/)) return true;
        
        // 4. Untagged response for data items (EXISTS, RECENT, FLAGS, etc.)
        if (checkString.match(/^\* \d+ [A-Z]+/) && checkString.match(/\r\n$/)) return true;
        
        // 5. Multi-line response that ends with a tagged status response
        const lines = checkString.split('\r\n');
        const lastLine = lines[lines.length - 2]; // Last non-empty line
        if (lastLine && lastLine.match(/^A\d+ (OK|NO|BAD|BYE)/)) return true;
        
        // None of the completion patterns matched
        return false;
    }

    async *fetchEmails(since: Date, folder: string = "INBOX", excludeIds: number[] = []): AsyncGenerator<Email> {
        this.context.logger.info(`Fetching emails since ${since} from ${folder}, excluding ${excludeIds.join(', ')}`);
        try {
            await this.connect();
            await this.login();
            await this.select(folder);
            
            const messageIds = await this.search(since);
            this.context.logger.info(`Found ${messageIds.length} messages: ${messageIds.join(', ')}`);
            
            let processedCount = 0;
            for (const id of messageIds) {
                this.context.logger.debug(`Processing message ${id} (${processedCount + 1}/${messageIds.length})`);
                
                const rfc822 = await this.fetch(id);
                this.context.logger.debug(`Fetch completed for message ${id}, rfc822 length: ${rfc822?.length || 0}`);
                
                if (rfc822) {
                    const email = emailRawToObject(rfc822);
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
            
            this.context.logger.info(`Completed processing ${processedCount}/${messageIds.length} messages`);
        } catch (error) {
            this.context.logger.error('Error fetching emails:', error);
            throw error;
        } finally {
            try {
                if (this.connection) {
                    await this.sendCommand('LOGOUT');
                    await this.readAndIgnore();
                    this.connection.close();
                }
            } catch (error) {
                this.context.logger.warning('Error closing IMAP connection:', error);
            }
        }
    }

    async writeEmailToFolder(email: Email, folder: string = "OUTBOX"): Promise<number> {
        try {
            await this.connect();
            await this.login();
            
            // Convert email to RFC822 format
            const rfc822 = objectEmailToRaw(email);
            
            // Calculate the length of the message in bytes
            const encoder = new TextEncoder();
            const messageBytes = encoder.encode(rfc822);
            
            // Send APPEND command with the message
            await this.sendCommand(`APPEND "${folder}" (\\Seen) {${messageBytes.length}}`);
            
            try {
                await this.readContinuation();
            } catch (error) {
                this.context.logger.error('Error reading continuation response:', error);
                return 500;
            }
            
            // Send the message content
            await this.writer?.write(messageBytes);
            await this.writer?.write(encoder.encode('\r\n'));
            
            // Wait for the final response
            const ok = await this.readAndIgnore();
            if (!ok) {
                this.context.logger.error('Failed to append message to folder');
                return 500;
            }
            return 0;
        } catch (error) {
            this.context.logger.error('Error writing email to folder:', error);
            throw error;
        } finally {
            try {
                if (this.connection) {
                    await this.sendCommand('LOGOUT');
                    await this.readAndIgnore();
                    this.connection.close();
                }
            } catch (error) {
                this.context.logger.warning('Error closing IMAP connection:', error);
            }
        }
    }
}