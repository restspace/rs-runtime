export default {
    "name": "MongoDB Data Adapter",
    "description": "Reads and writes data to MongoDB-compatible databases (MongoDB Atlas/local, Amazon DocumentDB)",
    "moduleUrl": "./adapter/MongoDbDataAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "url": { "type": "string", "description": "MongoDB connection URI (mongodb:// or mongodb+srv://)" },
            "dbName": { "type": "string", "description": "Database name" },
            "tlsCAFile": { "type": "string", "description": "Optional path to CA bundle (commonly required for DocumentDB TLS)" },
            "schemaCollection": { "type": "string", "description": "Optional collection name for schema storage (default _schemas)" }
        },
        "required": [ "url", "dbName" ]
    },
    "adapterInterfaces": [ "IDataAdapter", "ISchemaAdapter" ]
};
