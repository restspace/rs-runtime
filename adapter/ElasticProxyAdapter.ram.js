export default {
    "name": "Elasticsearch Proxy Adapter",
    "description": "Forwards a request to a configured elasticsearch node using provided user and password",
    "moduleUrl": "./adapter/ElasticProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "username": { "type": "string", "description": "Elastic account username" },
            "password": { "type": "string", "description": "Elastic account password" },
            "host": { "type": "string", "description": "Elastic node host (starting http:// or https://)" }
        },
        "required": [ "host" ]
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}