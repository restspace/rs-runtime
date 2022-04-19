export default {
    "name": "Discord Service",
    "description": "Manages command creation for Discord",
    "moduleUrl": "./services/discord.ts",
    "apis": [ "store" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "applicationId": { "type": "string" },
	        "botToken": { "type": "string" },
	        "publicKey": { "type": "string" },
	        "guildIds": { "type": "array", "items": { "type": "string" } }
        },
        "required": [ "applicationId", "botToken", "publicKey" ]
    }
}