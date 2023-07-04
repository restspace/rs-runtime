export default {
    "name": "File Service",
    "description": "GET files from urls and PUT files to urls",
    "moduleUrl": "./services/file.ts",
    "apis": [ "store", "file.base" ],
    "adapterInterface": "IFileAdapter",
    "configSchema": {
        "type": "object",
        "properties": {
            "extensions": { "type": "array", "items": { "type": "string" }, "description": "Optional list of the file extensions allowed to be stored" },
            "parentIfMissing": { "type": "boolean", "description": "Optional flag which if set, when a missing file is requested, will substitute the nearest parent file on the path tree if one exists" },
            "defaultResource": { "type": "string", "description": "If a file which is a directory is requested, serve the file with this name in the directory instead" },
            "storesTransforms": { "type": "boolean", "description": "Set if the file service stores transforms" },
            "manualMimeTypes": {
				"type": "object",
				"properties": {
					"requestMimeType": { "type": "string" },
					"requestSchema": { "type": "object" },
					"responseMimeType": { "type": "string" },
					"responseSchema": { "type": "object" }
				}
			}
        }
    }
}