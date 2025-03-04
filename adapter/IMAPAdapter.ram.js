export default {
    "name": "IMAP Email Fetch Adapter",
    "description": "Gets all new emails since date from an IMAP server",
    "moduleUrl": "./adapter/IMAPAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "host": { "type": "string", "description": "IMAP server host" },
            "port": { "type": "number", "description": "IMAP server port" },
            "secure": { "type": "boolean", "description": "Whether to use secure (TLS) connection" },
            "user": { "type": "string", "description": "IMAP server user" },
            "password": { "type": "string", "description": "IMAP server password" }
        }
    },
    "adapterInterfaces": [ "IEmailFetchAdapter" ]
}