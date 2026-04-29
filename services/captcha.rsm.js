export default {
    "name": "Captcha Service",
    "description": "Provider-neutral captcha rendering and verification service",
    "moduleUrl": "./services/captcha.ts",
    "apis": [ "view", "captcha" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "maxTokenLength": {
                "type": "number",
                "description": "Maximum accepted captcha token length before provider verification"
            }
        }
    },
    "adapterInterface": "ICaptchaAdapter"
}

