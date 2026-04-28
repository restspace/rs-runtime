export default {
    "name": "Turnstile Captcha Adapter",
    "description": "Renders and verifies Cloudflare Turnstile captcha challenges",
    "moduleUrl": "./adapter/TurnstileCaptchaAdapter.ts",
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

