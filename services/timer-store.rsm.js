export default {
	"name": "Timer Store",
    "description": "Stores timer specifications and runs them to trigger events at specific times or intervals",
    "moduleUrl": "./services/timer-store.ts",
    "apis": [ "store-directory", "data.set" ],
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
    "postPipeline": [
        "if (method !== 'POST' && mime !== 'inode/directory+json' && status !== 200) $METHOD *store/$*"
    ],
    "privateServices": {
        "store": {
            "name": "'Timer Spec Store'",
            "datasetName": "'TimerSpecs'",
            "storePattern": "'store-directory'",
            "source": "./services/dataset.rsm.json",
            "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
            "adapterInterface": "IDataAdapter",
            "adapterSource": "store.adapterSource",
            "infraName": "store.infraName",
            "adapterConfig": "store.adapterConfig",
            "extensions": "[ 'json' ]",
            "parentIfMissing": "store.parentIfMissing === false ? false : true",
            "schema": [
                "literal()",
                {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Name of the timer" },
                        "repeatDuration": { "type": "string", "description": "ISO 8601 duration of the base interval" },
                        "maxRandomAdditionalMs": { "type": "number", "description": "Adds a random additional interval from 0 to this value ms" },
                        "maxRepeats": { "type": "number", "description": "Maximum number of times to repeat the interval" },
                        "repeatUntil": { "type": "string", "description": "Date time at which to stop repeating" },
                        "autoStart": { "type": "boolean", "description": "If true, starts the timer as soon as Restspace loads" },
                        "triggerUrl": { "type": "string", "description": "URL to trigger when the timer fires" }
                    },
                    "required": [ "name", "repeatDuration", "triggerUrl" ],
                    "pathPattern": "${name}"
                }
            ]
        }
    }
}