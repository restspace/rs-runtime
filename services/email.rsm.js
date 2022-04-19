export default {
    "name": "Email Service",
    "description": "Send an email optionally with attachments",
    "moduleUrl": "./services/email.ts",
    "apis": [ "email" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "host": { "type": "string" },
            "port": { "type": "number" },
            "secure": { "type": "boolean" },
            "user": { "type": "string" },
            "password": { "type": "string" },
            "defaultFrom": { "type": "string", "description": "From address is not specified" }
        },
        "required": [ "host", "port", "secure", "user", "password", "defaultFrom" ]
    }
}