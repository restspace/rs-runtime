export default {
    "name": "Service store service",
    "description": "Stores files for service and adapter code and manifests",
    "moduleUrl": "./services/file.ts",
    "apis": [ "store", "file.base" ],
    "adapterInterface": "IFileAdapter",
    "configTemplate": {
        "$this": "$this",
        "extensions": [ "'ts'", "'json'" ],
        "parentIfMissing": "false",
        "defaultResource": "''"
    }
}