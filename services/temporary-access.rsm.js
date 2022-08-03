export default {
    "name": "Temporary access service",
    "description": "Generates a token for temporary access to resources and then gives access",
    "moduleUrl": "./services/temporary-access.ts",
    "apis": [ "access-token" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "acquiredRole": { "type": "string", "description": "The role which use of the token grants to the request" },
            "expirySecs": { "type": "number", "description": "Number of seconds for which the token is valid" }
        }
    }
}