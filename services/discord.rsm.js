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
            "receiveIntents": { "type": "array", "items": {
                "type": "string",
                "enum": [ "GUILDS", "GUILD_MEMBERS", "GUILD_BANS", "GUILD_EMOJIS_AND_STICKERS",
                    "GUILD_INTEGRATIONS", "GUILD_WEBHOOKS", "GUILD_INVITES",
                    "GUILD_VOICE_STATES", "GUILD_PRESENCES", "GUILD_MESSAGES",
                    "GUILD_MESSAGE_REACTIONS", "GUILD_MESSAGE_TYPING", "DIRECT_MESSAGES",
                    "DIRECT_MESSAGE_REACTIONS", "DIRECT_MESSAGE_TYPING", "MESSAGE_CONTENT",
                    "GUILD_SCHEDULED_EVENTS", "AUTO_MODERATED_CONFIGURATION", "AUTO_MODERATED_EXECUTION" ]
            } },
            "triggerUrl": { "type": "string", "description": "Url pattern called when Discord calls the service with an interaction" },
            "memberStoreUrl": { "type": "string", "description": "Url pattern where the service stores member data" },
            "messageStoreUrl": { "type": "string", "description": "Url pattern where the service stores message data" }
        },
        "required": [ "publicKey", "proxyAdapterConfig" ]
    },
    "proxyAdapterSource": "./adapter/DiscordProxyAdapter.ts" 
}