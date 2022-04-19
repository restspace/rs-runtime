import { Message } from "rs-core/Message.ts";
import { config, LogLevel, setupLogging } from "./config.ts";
import { getServerConfig } from "./getServerConfig.ts";
import { handleIncomingRequest } from "./handleRequest.ts";

config.server = await getServerConfig(Deno.args[0]);
const port = parseInt(Deno.args[1]) || 3100;
if (isNaN(port)) {
    console.log(`Port argument ${Deno.args[1]} is not a number`);
    Deno.exit(1);
}

const logLevel = Deno.args.length > 2 ? Deno.args[2] as LogLevel : "INFO";
await setupLogging(logLevel);

const listener = Deno.listen({ port });
console.log(`receiving requests from http://localhost:${port}/`);
for await (const conn of listener) {
    (async () => {
        try {
            for await (const { request, respondWith } of Deno.serveHttp(conn)) {
                try {
                    const msgIn = Message.fromRequest(request, '');
                    if (config.server.incomingAlwaysHttps) msgIn.url.scheme = "https://";
                    if (msgIn.getHeader("upgrade") === "websocket") {
                        const { socket, response } = Deno.upgradeWebSocket(request);
                        msgIn.websocket = socket;
                        await handleIncomingRequest(msgIn);
                        await respondWith(response);
                    }
                    const msgOut = await handleIncomingRequest(msgIn);
                    await respondWith(msgOut.toResponse());
                } catch (err) {
                    console.error('Request loop error: ' + err.toString());
                }
            }
        } catch (err) {
            console.error(err);
        }
    })();
}