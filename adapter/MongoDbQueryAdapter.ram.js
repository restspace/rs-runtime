export default {
    "name": "MongoDb Query Adapter",
    "description": "Stores and runs MongoDb queries",
    "moduleUrl": "./adapter/MongoDbQueryAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "url": { "type": "string" }
        },
        "required": [ "url" ]
    },
    "adapterInterfaces": [ "IQueryAdapter" ]
}