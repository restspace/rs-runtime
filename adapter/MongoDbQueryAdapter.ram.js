export default {
    "name": "MongoDB Query Adapter",
    "description": "Runs MongoDB aggregation queries (MongoDB Atlas/local, Amazon DocumentDB)",
    "moduleUrl": "./adapter/MongoDbQueryAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "url": { "type": "string", "description": "MongoDB connection URI (mongodb:// or mongodb+srv://)" },
            "dbName": { "type": "string", "description": "Database name" },
            "tlsCAFile": { "type": "string", "description": "Optional path to CA bundle (commonly required for DocumentDB TLS)" },
            "ignoreEmptyVariables": { "type": "boolean", "description": "When true, empty string variables produce $ignore markers that remove the containing field from queries" }
        },
        "required": [ "url", "dbName" ]
    },
    "adapterInterfaces": [ "IQueryAdapter" ]
}
