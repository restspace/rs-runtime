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

await Deno.serve({ port }, async (request) => {
    let msgIn: Message | null = null;
    try {
        msgIn = Message.fromRequest(request, '');
        if (config.server.incomingAlwaysHttps) msgIn.url.scheme = "https://";
        
        if (msgIn.getHeader("upgrade") === "websocket") {
            const { socket, response } = Deno.upgradeWebSocket(request);
            msgIn.websocket = socket;
            await handleIncomingRequest(msgIn);
            return response;
        }

        const msgOut = await handleIncomingRequest(msgIn);
        return msgOut.toResponse();
    } catch (err) {
        if (msgIn && (err as Error)?.toString()?.includes("connection closed")) {
            // client aborted request
            config.requestAbortActions.abort(msgIn.traceId);
        } else {
            console.error('Request handler error: ' + (err as Error)?.toString());
        }
        return new Response("Internal Server Error", { status: 500 });
    } finally {
        config.requestAbortActions.clear(msgIn?.traceId || '');
    }
}).finished;