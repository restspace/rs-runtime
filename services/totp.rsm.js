export default {
    "name": "TOTP Service",
    "description": "Google Authenticator compatible TOTP enrollment and verification",
    "moduleUrl": "./services/totp.ts",
    "apis": [ "directory","totp" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "userUrlPattern": { "type": "string", "description": "Url pattern to fetch user data" },
            "issuer": { "type": "string", "description": "Issuer used in otpauth URL (defaults to host)" },
            "digits": { "type": "number", "description": "TOTP digits (default 6)" },
            "periodSeconds": { "type": "number", "description": "TOTP period in seconds (default 30)" },
            "skewSteps": { "type": "number", "description": "Allowed +/- time steps (default 1)" },
            "masterKeyEnvVar": { "type": "string", "description": "Env var name containing base64 master key (default RS_TOTP_MASTER_KEY)" },
            "lockout": {
                "type": "object",
                "properties": {
                    "maxAttempts": { "type": "number", "description": "Failed attempts before lock (default 5)" },
                    "lockMinutes": { "type": "number", "description": "Lock duration minutes (default 10)" }
                }
            }
        },
        "required": [ "userUrlPattern" ]
    }
};

