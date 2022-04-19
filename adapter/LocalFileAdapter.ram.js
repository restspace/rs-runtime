export default {
    "name": "Local File Adapter",
    "description": "Reads and writes files on the file system local to the runtime",
    "moduleUrl": "./adapter/LocalFileAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "rootPath": { "type": "string", "description": "File path to root of all file storage" },
            "basePath": { "type": "string", "description": "Path below root path to storage for this service (generally unique)" }
        }
    },
    "adapterInterfaces": [ "IFileAdapter", "IDataAdapter" ]
}