export default {
	"name": "Web Scraper",
    "description": "Stores scraping specifications and runs them to extract data from multiple pages across a web site",
    "moduleUrl": "./services/webScraperService.ts",
    "apis": [ "store-transform", "file.base" ],
    "adapterInterface": "IProxyAdapter",
	"isFilter": true,
    "configSchema": {
        "type": "object",
        "properties": {
            "store": {
                "type": "object",
                "description": "Configuration for the spec store",
                "properties": {
                    "adapterSource": { "type": "string", "description": "Source url for adapter for spec store" },
                    "infraName": { "type": "string", "description": "Infra name for spec store" },
                    "adapterConfig": { "type": "object", "properties": {} },
                    "parentIfMissing": { "type": "boolean", "description": "Optional flag which for a pipeline on a path, sends all subpaths to that pipeline as well. Default true" }
                }
            }
        },
        "required": [ "store" ]
    },
    "postPipeline": [ "if (method !== 'POST') $METHOD store/$*" ],
    "privateServices": {
        "store": {
            "name": "'Scraper Spec Store'",
            "storesTransforms": "true",
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