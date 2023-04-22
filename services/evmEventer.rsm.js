export default {
    "name": "EVM Event Handler",
    "description": "Forwards API call style events from EVM blockchains",
    "moduleUrl": "./services/evmEventer.ts",
    "apis": [ ],
    "configSchema": {
        "type": "object",
        "properties": {
	        "triggerUrlBase": { "type": "string" },
	        "contractAddress": { "type": "string" },
            "alchemyHttpsUrl": { "type": "string" },
            "userUrlIndexedByAddress": { "type": "string" },
        },
        "required": [ "triggerUrlBase", "contractAddress", "alchemyWebSocketUrl", "userUrlIndexedByAddress" ]
    },
    "proxyAdapterSource": "./adapter/DiscordProxyAdapter.ts" 
}