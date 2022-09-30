export default {
	"name": "Query",
    "description": "Stores queries as text files and runs the query in the file parameterised with a POST body to produce the response",
    "moduleUrl": "./services/query.ts",
    "apis": [ "store-transform" ],
    "adapterInterface": "IQueryAdapter",
	"isFilter": true,
    "configSchema": {
        "type": "object",
        "properties": {
            "outputMime": { "type": "string" },
            "store": {
                "type": "object",
                "description": "Configuration for the template store",
                "properties": {
                    "adapterSource": { "type": "string", "description": "Source url for adapter for query store" },
                    "infraName": { "type": "string", "description": "Infra name for query store" },
                    "adapterConfig": { "type": "object", "properties": {} },
                    "extension": { "type": "string", "description": "Extension for query files" },
                    "parentIfMissing": { "type": "boolean", "description": "Optional flag which for a pipeline on a path, sends all subpaths to that pipeline as well. Default true" }
                },
                "required": [ "extension" ]
            }
        },
        "required": [ "outputMime", "store" ]
    },
    "postPipeline": [ "if (method !== 'POST') $METHOD store/$*" ],
    "privateServices": {
        "store": {
            "name": "'Query Store'",
            "source": "./services/file.rsm.json",
            "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
            "adapterInterface": "IFileAdapter",
            "adapterSource": "store.adapterSource",
            "infraName": "store.infraName",
            "adapterConfig": "store.adapterConfig",
            "extensions": "[ store.extension ]",
            "parentIfMissing": "store.parentIfMissing === false ? false : true"
        }
    }
}