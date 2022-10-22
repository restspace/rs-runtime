export default {
    "name": "Authentication Service",
    "description": "Provides simple JWT authentication",
    "moduleUrl": "./services/auth.ts",
    "apis": [ "auth" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "userUrlPattern": { "type": "string", "description": "Url pattern to fetch user data" },
            "loginPage": { "type": "string", "description": "Login page url for redirect management" },
            "sessionTimeoutMins": { "type": "number", "description": "How long before a new login is required in minutes" }
        },
        "required": [ "userUrlPattern" ]
    }
}