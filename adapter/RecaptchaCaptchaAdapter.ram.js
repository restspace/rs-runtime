export default {
    "name": "reCAPTCHA Captcha Adapter",
    "description": "Renders and verifies Google reCAPTCHA challenges",
    "moduleUrl": "./adapter/RecaptchaCaptchaAdapter.ts",
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

