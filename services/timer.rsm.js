export default {
	"name": "Timer",
    "description": "Trigger a pipeline at regular intervals",
    "moduleUrl": "./services/timer.ts",
    "apis": [ "directory" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "triggerUrl": { "type": "string", "description": "Url receiving a POST request every second" },
            "repeatDuration": { "type": "string", "description": "ISO 8601 Duration between triggers" },
            "maxRandomAdditionalMs": { "type": "number", "description": "A random number between zero and this value in milliseconds is added to each repeat duration" },
            "autoStart": { "type": "boolean", "description": "whether the timer starts as soon as the server initialises (true)" }
        },
        "required": [ "repeatDuration" ]
    }
}