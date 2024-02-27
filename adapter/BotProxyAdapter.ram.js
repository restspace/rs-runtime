export default {
    "name": "Bot Proxy Adapter",
    "description": "Forwards a request to a configured path pattern adding mock browser headers suitable for web scraping",
    "moduleUrl": "./adapter/BotProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "urlPattern": { "type": "string", "description": "Url pattern where to send request" }
        }
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}