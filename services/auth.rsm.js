export default {
    "name": "Authentication Service",
    "description": "Provides simple JWT authentication",
    "moduleUrl": "./services/auth.ts",
    "apis": [ "auth" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "userUrlPattern": { "type": "string", "description": "Url pattern to fetch user data" },
            "loginPage": { "type": "string", "description": "Login page url for redirect management" }
        },
        "required": [ "userUrlPattern" ]
    }
}