export default {
    "name": "Discord Service",
    "description": "Manages command creation for Discord",
    "moduleUrl": "./services/discord.ts",
    "apis": [ "store" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "proxyAdapterConfig": {
                "type": "object",
                "properties": {
                    "applicationId": { "type": "string" },
	                "botToken": { "type": "string" }
                },
                "required": [ "applicationId", "botToken" ]
            },
	        "publicKey": { "type": "string" },
	        "guildIds": { "type": "array", "items": { "type": "string" } },
            "triggerUrl": { "type": "string", "description": "Url pattern called when Discord calls the service with an interaction" }
        },
        "required": [ "publicKey", "proxyAdapterConfig" ]
    },
    "proxyAdapterSource": "./adapter/DiscordProxyAdapter.ts" 
}