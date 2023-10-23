export default {
    "name": "Simple Proxy Adapter",
    "description": "Forwards a request to a configured path pattern without adding headers",
    "moduleUrl": "./adapter/SimpleProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "urlPattern": { "type": "string", "description": "Url pattern where to send request" },
            "basicAuthentication": {
                "type": "object", "description": "An optional basic auth username and password",
                "properties": {
                    "username": { "type": "string" },
                    "password": { "type": "string" }
                }
            },
            "bearerToken": {
                "type": "string",
                "description": "A token to be sent as via Authorization: Bearer header"
            }
        },
        "required": [ "urlPattern" ]
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}