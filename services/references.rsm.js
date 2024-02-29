export default {
	"name": "References",
    "description": "Manages changes to referenced values in a JSON data item using stored reference specs",
    "moduleUrl": "./services/references.ts",
    "apis": [ "store-transform", "file.base" ],
	"isFilter": true,
    "configSchema": {
        "type": "object",
        "properties": {
            "store": {
                "type": "object",
                "description": "Configuration for the reference spec store",
                "properties": {
                    "adapterSource": { "type": "string", "description": "Source url for adapter for reference spec store" },
                    "infraName": { "type": "string", "description": "Infra name for reference spec store" },
                    "adapterConfig": { "type": "object", "properties": {} }
                }
            }
        },
        "required": [ "store" ]
    },
    "postPipeline": [ "if (method !== 'POST') $METHOD store/$*" ],
    "privateServices": {
        "store": {
            "name": "'Reference Sepc Store'",
            "storesTransforms": "true",
            "source": "./services/file.rsm.json",
            "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
            "adapterInterface": "IFileAdapter",
            "adapterSource": "store.adapterSource",
            "infraName": "store.infraName",
            "adapterConfig": "store.adapterConfig",
            "extensions": "[ 'json' ]",
            "parentIfMissing": "true"
        }
    }
}