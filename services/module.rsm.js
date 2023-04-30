export default {
    "name": "Module service",
    "description": "Stores module code and manifests",
    "moduleUrl": "./services/file.ts",
    "apis": [ "store", "file.base" ],
    "adapterInterface": "IFileAdapter",
    "configTemplate": {
        "source": "./services/file.rsm.json",
        "$this": "$this",
        "extensions": [ "'json'", "'ts'" ]
    }
}