export default {
    "name": "User data service",
    "description": "Manages access to and stores user data",
    "moduleUrl": "./services/dataset.ts",
    "apis": [ "store", "data.set" ],
    "adapterInterface": "IDataAdapter",
    "prePipeline": [ "$METHOD userFilter/$*" ],
    "postPipeline": [ "$METHOD userFilter/$*" ],
    "privateServices": {
        "userFilter": {
            "name": "'User filter'",
            "access": { "readRoles": "'all'", "writeRoles": "'all'" },
            "source": "./services/user-filter.rsm.json"
        }
    }
}