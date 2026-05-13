export default {
    "name": "Elasticsearch Data Adapter",
    "description": "Reads and writes data to Elasticsearch with tenant-prefixed indexes by default",
    "moduleUrl": "./adapter/ElasticDataAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "username": { "type": "string" },
            "password": { "type": "string" },
            "host": { "type": "string", "description": "Elastic node host (starting http:// or https://)" },
            "writeDelayMs": { "type": "number" },
            "tenantIndexes": { "type": "boolean", "description": "When true or omitted, Elasticsearch indexes are prefixed with the safe tenant storage prefix. When false, logical index names are shared across allowed tenants." }
        },
        "required": [ "host" ]
    },
    "infraOnlyConfigProperties": [ "tenantIndexes" ],
    "adapterInterfaces": [ "IDataAdapter" ]
}
