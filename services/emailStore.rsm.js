export default {
    "name": "Email Store Service",
    "description": "Polls email server to find new emails and triggers an action for each one, manages folders of the email server",
    "moduleUrl": "./services/emailStore.ts",
    "apis": [ "operation" ],
    "adapterInterface": "IEmailStoreAdapter",
    "configSchema": {
        "type": "object",
        "properties": {
            "repeatDuration": { "type": "string", "description": "ISO 8601 duration of how often to check for new emails" },
            "maxRandomAdditionalMs": { "type": "number", "description": "Maximum additional milliseconds to wait for next check" },
            "autoStart": { "type": "boolean", "description": "If true, the service will start automatically" },
            "triggerUrl": { "type": "string", "description": "URL to which to POST each new email as it arrives" }
        },
        "required": [ "repeatDuration", "maxRandomAdditionalMs", "autoStart", "triggerUrl" ]
    }
}