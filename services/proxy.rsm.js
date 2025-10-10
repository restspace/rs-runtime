export default {
    "name": "Proxy Service",
    "description": "Forwards requests with server defined authentication or urls",
    "moduleUrl": "./services/proxy.ts",
    "apis": [ "proxy", "transform" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "corsAllowedHeaders": {
                "type": "array",
                "description": "Extra headers allowed by CORS for this proxied service",
                "items": { "type": "string" }
            }
        }
    },
    "adapterInterface": "IProxyAdapter"
}