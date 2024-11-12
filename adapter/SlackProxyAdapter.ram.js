export default {
    "name": "Slack Proxy Adapter",
    "description": "Handles authentication and URL formatting for Slack API requests",
    "moduleUrl": "./adapter/SlackProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "botToken": { 
                "type": "string", 
                "description": "Slack Bot User OAuth Token (xoxb-...)" 
            },
            "apiVersion": {
                "type": "string",
                "description": "Slack API version (defaults to v2)",
                "default": "v2"
            }
        },
        "required": [ "botToken" ]
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}; 