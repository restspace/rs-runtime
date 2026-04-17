import { Message } from "rs-core/Message.ts";
import { config, IServerConfig } from "./config.ts";

export const getServerConfig = async (serverConfigLocation: string) => {
    if (!serverConfigLocation) throw new Error('Missing server config location');

    try {
        const serverConfigText = await Deno.readTextFile(serverConfigLocation);
        const serverConfig = JSON.parse(serverConfigText) as IServerConfig;
        serverConfig.setServerCors = makeServerCorsSetter();
        return serverConfig;
    } catch (err) {
        throw new Error(`Failed to load server config: ${err}`);
    }
}

export const makeServerCorsSetter = () => (msg: Message) => {
    const origin = msg.getHeader('origin');
    if (origin) {
        msg.setHeader('Access-Control-Allow-Origin', origin);
        const existingVary = (msg.getHeader("Vary") || "")
            .split(",")
            .map((part) => part.trim())
            .filter((part) => !!part);
        if (!existingVary.some((part) => part.toLowerCase() === "origin")) {
            msg.setHeader("Vary", [ ...existingVary, "Origin" ].join(", "));
        }
        msg.setHeader(
            'Access-Control-Allow-Headers',
            'Origin,X-Requested-With,Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Restspace-Request-Mode'
        );
        msg.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, POST, PUT, PATCH, DELETE');
        msg.removeHeader('Access-Control-Allow-Credentials');
        msg.setHeader('Access-Control-Expose-Headers', 'X-Restspace-Service');
    }
    return msg;
}
