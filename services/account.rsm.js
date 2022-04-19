export default {
    "name": "Account Service",
    "description": "Provides password reset and email verification",
    "moduleUrl": "./services/account.ts",
    "apis": [ "account" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "userUrlPattern": { "type": "string", "description": "Url pattern to fetch user data from" },
            "emailSendUrlPattern": { "type": "string", "description": "Url pattern to POST to for sending an email" },
            "passwordReset": { "type": "object", "description": "Config for a function allowing a user to reset their password via emailed tokenised url",
                "properties": {
                    "tokenExpiryMins": { "type": "number" },
                    "returnPageUrl": { "type": "string", "description": "url for page containing a form which posts to the service's token-update-password path" },
                    "emailTemplateUrl": { "type": "string", "description": "url for template to create email sent to user when the service's reset-password path is called" },
                },
                "required": [ "returnPageUrl", "emailTemplateUrl" ]
            },
            "emailConfirm": { "type": "object", "description": "Config for a function allowing a user to validate their email via emailed tokenised url",
                "properties": {
                    "tokenExpiryMins": { "type": "number" },
                    "returnPageUrl": { "type": "string", "description": "url for page containing a form which posts to the service's confirm-email path" },
                    "emailTemplateUrl": { "type": "string", "description": "url for template to create email sent to user when the service's verify-email path is called" },
                },
                "required": [ "returnPageUrl", "emailTemplateUrl" ]
            }
         }, 
        "required": [ "userUrlPattern", "emailSendUrlPattern" ]
    }
}