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
            "sessionTimeoutMins": { "type": "number", "description": "How long before a new login is required in minutes" },
            "jwtUserProps": {
                "type": "array",
                "description": "Extra user record properties to embed in the JWT (safe primitives only; sensitive fields are ignored)",
                "items": { "type": "string" }
            },
            "mfa": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "description": "MFA mode: challenge or singleStep" },
                    "totpServiceUrl": { "type": "string", "description": "Base url for the TOTP service (e.g. /mfa)" },
                    "mfaCookieName": { "type": "string", "description": "Cookie name used for MFA challenge (default rs-mfa; must not be rs-auth)" },
                    "mfaTimeoutMins": { "type": "number", "description": "Minutes before MFA challenge expires (default 5)" }
                }
            }
        },
        "required": [ "userUrlPattern" ]
    }
}