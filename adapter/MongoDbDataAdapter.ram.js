export default {
    "name": "DocumentDB Data Adapter",
    "description": "Reads and writes data to Amazon DocumentDB",
    "moduleUrl": "./adapter/MongoDbDataAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "url": { "type": "string", "description": "MongoDB connection string url" }
        },
        "required": [ "url" ]
    },
    "adapterInterfaces": [ "IDataAdapter", "ISchemaAdapter" ]
};