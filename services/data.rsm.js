export default {
    "name": "Data Service",
    "description": "Reads and writes data from urls with the pattern datasource/key",
    "moduleUrl": "./services/data.ts",
    "apis": [ "store", "data.base" ],
    "adapterInterface": "IDataAdapter",
    "defaults": {
        "basePath": "/data",
        "xyz": "abc"
    }
}