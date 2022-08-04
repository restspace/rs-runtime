export default {
    "name": "Data Service",
    "description": "Reads and writes data from urls with the pattern datasource/key",
    "moduleUrl": "./services/data.ts",
    "apis": [ "store", "data.base" ],
    "adapterInterface": "IDataAdapter",
    "configSchema": {
        "type": "object",
        "properties": {
            "uploadBaseUrl": { "type": "string", "description": "The url to a file store for uploading associated files" }
        }
    },
    "defaults": {
        "basePath": "/data"
    },
    "exposedConfigProperties": [ "uploadBaseUrl" ]
}