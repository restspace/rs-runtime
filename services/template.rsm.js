export default {
	"name": "Template",
    "description": "Fill a template with data from the request",
    "moduleUrl": "./services/template.ts",
    "apis": [ "store-transform" ],
    "adapterInterface": "ITemplateAdapter",
	"isFilter": true,
    "configSchema": {
        "type": "object",
        "properties": {
            "outputMime": { "type": "string" },
            "store": {
                "type": "object",
                "description": "Configuration for the template store",
                "properties": {
                    "adapterSource": { "type": "string", "description": "Source url for adapter for template store" },
                    "infraName": { "type": "string", "description": "Infra name for template store" },
                    "adapterConfig": { "type": "object", "properties": {} },
                    "extension": { "type": "string", "description": "Extension for template files" }
                },
            }
        },
        "required": [ "outputMime", "store" ]
    },
    "postPipeline": [ "if (method !== 'POST') $METHOD store/$*" ],
    "privateServices": {
        "store": {
            "name": "'Template Store'",
            "source": "./services/file.rsm.json",
            "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
            "adapterInterface": "IFileAdapter",
            "adapterSource": "store.adapterSource",
            "infraName": "store.infraName",
            "adapterConfig": "store.adapterConfig",
            "extensions": "[ store.extension ]"
        }
    }
}