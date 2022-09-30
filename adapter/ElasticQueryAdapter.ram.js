export default {
    "name": "Elasticsearch Query Adapter",
    "description": "Stores and runs Elasticsearch queries",
    "moduleUrl": "./adapter/ElasticQueryAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "username": { "type": "string" },
            "password": { "type": "string" },
            "host": { "type": "string", "description": "Elastic node host (starting http:// or https://)" }
        },
        "required": [ "host" ]
    },
    "adapterInterfaces": [ "IQueryAdapter" ]
}