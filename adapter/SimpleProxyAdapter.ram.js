export default {
    "name": "Simple Proxy Adapter",
    "description": "Forwards a request to a configured path pattern without adding headers",
    "moduleUrl": "./adapter/SimpleProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "urlPattern": { "type": "string", "description": "Url pattern where to send request" }
        },
        "required": [ "urlPattern" ]
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}