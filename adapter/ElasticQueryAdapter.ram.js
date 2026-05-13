export default {
    "name": "Elasticsearch Query Adapter",
    "description": "Runs Elasticsearch queries against tenant-prefixed indexes by default",
    "moduleUrl": "./adapter/ElasticQueryAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "username": { "type": "string" },
            "password": { "type": "string" },
            "host": { "type": "string", "description": "Elastic node host (starting http:// or https://)" },
            "tenantIndexes": { "type": "boolean", "description": "When true or omitted, Elasticsearch indexes are prefixed with the safe tenant storage prefix. When false, logical index names are shared across allowed tenants." }
        },
        "required": [ "host" ]
    },
    "infraOnlyConfigProperties": [ "tenantIndexes" ],
    "adapterInterfaces": [ "IQueryAdapter" ]
}
