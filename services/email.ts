import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { SMTPClient, SendConfig } from "https://deno.land/x/denomailer/mod.ts";
import { getExtension, isJson, isText } from "../../rs-core/mimeType.ts";

interface EmailServiceConfig extends IServiceConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    defaultFrom: string;
}

const service = new Service<IAdapter, EmailServiceConfig>();

service.post(async (msg, _context, config) => {
    const to = await msg.getParam("to", 0);
    if (!to) return msg.setStatus(400, 'No email address to send to');

    const client = new SMTPClient({
        connection: {
            hostname: config.host,
            port: config.port,
            auth: {
                username: config.user,
                password: config.password
            }
        }
    });

    const sendConfig = {
        to,
        cc: await msg.getParam("cc"),
        bcc: await msg.getParam("bcc"),
        from: await msg.getParam("from") || config.defaultFrom,
        subject: await msg.getParam("subject"),
        content: await msg.getParam("content"),
        html: await msg.getParam("html"),
        priority: await msg.getParam("priority")
    } as SendConfig;

    if (msg.data) {
        const { mimeType } = msg.data;
        if (mimeType === "text/html") {
            sendConfig.html = await msg.data.asString() || undefined;
        } else if (isText(mimeType)) {
            sendConfig.content = await msg.data.asString() || undefined;
        } else if (!isJson(mimeType)) {
            sendConfig.attachments = [];
            let idx = 0;
            for await (const subMsg of msg.splitData()) {
                idx++;
                const content = await subMsg.data!.asArrayBuffer();
                if (content) {
                    let ext = getExtension(subMsg.data!.mimeType);
                    ext = ext ? '.' + ext : '';
                    sendConfig.attachments.push({
                        encoding: "binary",
                        content,
                        contentType: subMsg.data!.mimeType,
                        filename: subMsg.data!.filename || `item${idx}${ext}`
                    });
                }
            }
        }
    }

    try {
        await client.send(sendConfig);
    } catch {
        return msg.setStatus(500, 'There was a problem sending the email via the remote server');
    } finally {
        client.close();
    }

    return msg.setData(null, "").setStatus(201);
});

export default service;