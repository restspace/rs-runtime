export default {
    "name": "Dataset Service",
    "description": "Reads and writes data with configured schema from urls by key",
    "moduleUrl": "./services/dataset.ts",
    "apis": [ "store", "data.set" ],
    "adapterInterface": "IDataAdapter",
    "configSchema": {
        "type": "object",
        "properties": {
            "datasetName": { "type": "string", "description": "The name for the dataset which corresponds to its name in the underlying service" },
            "schema": { "type": "object", "description": "The schema for all data items in the dataset" },
            "uploadBaseUrl": { "type": "string", "description": "The url to a file store for uploading associated files" }
        },
        "required": [ "datasetName" ]
    },
    "exposedConfigProperties": [ "datasetName", "schema" ]
}