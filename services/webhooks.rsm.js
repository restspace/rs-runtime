export default {
  "name": "Webhook Registry",
  "description": "Lightweight webhook registry and dispatcher with a data-backed store of registrants per event.",
  "moduleUrl": "./services/webhooks.ts",
  "apis": [ "store-transform" ],
  // Forward non-POST requests to the attached store for management (listing/reading registrants)
  "isFilter": true,
  "configSchema": {
    "type": "object",
    "properties": {
      "concurrency": { "type": "number", "description": "Max number of concurrent deliveries" },
      "perTargetTimeoutMs": { "type": "number", "description": "Per-target timeout in ms" },
      "retryCount": { "type": "number", "description": "Retries per target on failure/timeouts" },
      "store": {
        "type": "object",
        "description": "Configuration for the registrant store (IDataAdapter)",
        "properties": {
          "adapterSource": { "type": "string", "description": "Source url for adapter for registrant store" },
          "infraName": { "type": "string", "description": "Infra name for registrant store" },
          "adapterConfig": { "type": "object", "properties": {} },
          "parentIfMissing": { "type": "boolean", "description": "Default true: allow GET on missing to list nearest parent as empty" }
        }
      }
    },
    "required": [ "perTargetTimeoutMs", "store" ]
  },
  "postPipeline": [ "if (method !== 'POST') $METHOD *store/$*", "/lib/delocalise-store-location" ],
  "privateServices": {
    "store": {
      "name": "'Webhook Registrant Store'",
      "storePattern": "'store-transform'",
      "source": "./services/data.rsm.json",
      "access": { "readRoles": "access.readRoles", "writeRoles": "access.writeRoles" },
      "adapterInterface": "IDataAdapter",
      "adapterSource": "store.adapterSource",
      "infraName": "store.infraName",
      "adapterConfig": "store.adapterConfig",
      "parentIfMissing": "store.parentIfMissing === false ? false : true"
    }
  }
}