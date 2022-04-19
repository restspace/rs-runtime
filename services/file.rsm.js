export default {
    "name": "File Service",
    "description": "GET files from urls and PUT files to urls",
    "moduleUrl": "./services/file.ts",
    "apis": [ "store", "file.base" ],
    "adapterInterface": "IFileAdapter",
    "configSchema": {
        "type": "object",
        "properties": {
            "extensions": { "type": "array", "items": { "type": "string" }, "description": "Optional list of the file extensions allowed to be stored" }
        }
    }
}