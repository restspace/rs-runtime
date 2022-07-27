export default {
	"name": "Pipeline store",
    "description": "Run a pipeline whose specification is stored at the request url",
    "moduleUrl": "./services/pipeline-store.ts",
    "apis": [ "store-transform" ],
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
                    "adapterConfig": { "type": "object", "properties": {} }
                },
            }
        },
        "required": [ "store" ]
    },
    "postPipeline": [ "if (isManage && method !== 'POST') $METHOD store/$P*" ],
    "privateServices": {
        "store": {
            "name": "'Pipeline Store'",
            "source": "./services/file.rsm.json",
            "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
            "adapterInterface": "IFileAdapter",
            "adapterSource": "store.adapterSource",
            "infraName": "store.infraName",
            "adapterConfig": "store.adapterConfig",
            "extensions": "[ 'json' ]"
        }
    }
}