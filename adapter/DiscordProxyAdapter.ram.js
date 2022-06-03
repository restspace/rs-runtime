export default {
    "name": "Discord Proxy Adapter",
    "description": "Forwards a request to Discord with Bot authorization",
    "moduleUrl": "./adapter/DiscordProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "botToken": { "type": "string", "description": "AWS service e.g. s3" },
            "applicationId": { "type": "string", "description": "AWS region e.g. eu-west-1" }
        },
        "required": [ "urlPattern" ]
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}