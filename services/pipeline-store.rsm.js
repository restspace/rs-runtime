export default {
	"name": "Pipeline store",
    "description": "Run a pipeline whose specification is stored at the request url",
    "moduleUrl": "./services/pipeline-store.ts",
    "apis": [ "store-transform", "file.base" ],
	"isFilter": true,
    "configSchema": {
        "type": "object",
        "properties": {
            "store": {
                "type": "object",
                "description": "Configuration for the pipeline store",
                "properties": {
                    "adapterSource": { "type": "string", "description": "Source url for adapter for pipeline store" },
                    "infraName": { "type": "string", "description": "Infra name for pipeline store" },
                    "adapterConfig": { "type": "object", "properties": {} },
                    "parentIfMissing": { "type": "boolean", "description": "Optional flag which for a pipeline on a path, sends all subpaths to that pipeline as well. Default true" }
                },
            }
        },
        "required": [ "store" ]
    },
    // Only delegate to the backing store when the service explicitly returns status 0
    "postPipeline": [ "if ((isDirectory || (isManage && method !== 'POST')) && status === 0) $METHOD *store/$*", "/lib/delocalise-store-location" ],
    "privateServices": {
        "store": {
            "name": "'Pipeline Store'",
            "storePattern": "'store-transform'",
            "source": "./services/file.rsm.json",
            "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
            "adapterInterface": "IFileAdapter",
            "adapterSource": "store.adapterSource",
            "infraName": "store.infraName",
            "adapterConfig": "store.adapterConfig",
            "extensions": "[ 'json' ]",
            "parentIfMissing": "store.parentIfMissing === false ? false : true"
        }
    }
}