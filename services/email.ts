import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import mailer, { type EmailMessage } from "@neabyte/deno-mailer";
import { getExtension, isJson, isText } from "rs-core/mimeType.ts";

interface EmailServiceConfig extends IServiceConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    defaultFrom: string;
}

const service = new Service<IAdapter, EmailServiceConfig>();

service.post(async (msg, context, config) => {
    const to = await msg.getParam("to", 0);
    if (!to) return msg.setStatus(400, 'No email address to send to');

    const priority = await msg.getParam("priority");
    const sendConfig = {
        to,
        cc: await msg.getParam("cc"),
        bcc: await msg.getParam("bcc"),
        from: await msg.getParam("from") || config.defaultFrom,
        subject: await msg.getParam("subject") || "",
        text: await msg.getParam("content"),
        html: await msg.getParam("html"),
        headers: priority ? { "Priority": priority } : undefined
    } as EmailMessage;

    if (msg.data) {
        const { mimeType } = msg.data;
        if (mimeType === "text/html") {
            sendConfig.html = await msg.data.asString() || undefined;
        } else if (isText(mimeType)) {
            sendConfig.text = await msg.data.asString() || undefined;
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
                        encoding: "base64",
                        content: new Uint8Array(content),
                        contentType: subMsg.data!.mimeType,
                        filename: subMsg.data!.filename || `item${idx}${ext}`
                    });
                }
            }
        }
    }

    try {
        const transporter = mailer.transporter({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                type: "password",
                user: config.user,
                pass: config.password
            }
        });
        await transporter.send(sendConfig);
    } catch (err) {
        context.logger.error(`Email send failed via ${config.host}:${config.port} tls=${config.secure}: ${err}`);
        return msg.setStatus(500, 'There was a problem sending the email via the remote server');
    }

    return msg.setData(null, "").setStatus(201);
});

export default service;