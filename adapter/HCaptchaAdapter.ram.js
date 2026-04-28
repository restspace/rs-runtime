export default {
    "name": "hCaptcha Adapter",
    "description": "Renders and verifies hCaptcha challenges",
    "moduleUrl": "./adapter/HCaptchaAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "siteKey": { "type": "string" },
            "secretKey": { "type": "string" },
            "secretKeyEnvVar": { "type": "string" },
            "verifyUrl": { "type": "string" },
            "expectedHostname": { "type": "string" }
        },
        "required": [ "siteKey" ]
    },
    "adapterInterfaces": [ "ICaptchaAdapter" ]
}

