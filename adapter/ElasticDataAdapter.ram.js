export default {
    "name": "Elasticsearch Data Adapter",
    "description": "Reads and writes data to Elasticsearch",
    "moduleUrl": "./adapter/ElasticDataAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "username": { "type": "string" },
            "password": { "type": "string" },
            "host": { "type": "string", "description": "Elastic node host (starting http:// or https://)" }
        },
        "required": [ "host" ]
    },
    "adapterInterfaces": [ "IDataAdapter" ]
}