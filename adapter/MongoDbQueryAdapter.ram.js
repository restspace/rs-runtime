export default {
  "name": "MongoDB Query Adapter",
  "description":
    "Runs MongoDB aggregation queries against tenant-scoped databases (MongoDB Atlas/local, Amazon DocumentDB)",
  "moduleUrl": "./adapter/MongoDbQueryAdapter.ts",
  "configSchema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "MongoDB connection URI (mongodb:// or mongodb+srv://)",
      },
      "dbName": {
        "type": "string",
        "description":
          "Optional logical database name; physical database is tenant-prefixed when set, or the tenant name when omitted",
      },
      "tlsCAFile": {
        "type": "string",
        "description":
          "Optional path to CA bundle (commonly required for DocumentDB TLS)",
      },
      "ignoreEmptyVariables": {
        "type": "boolean",
        "description":
          "When true, empty string variables produce $ignore markers that remove the containing field from queries",
      },
    },
    "required": ["url"],
  },
  "adapterInterfaces": ["IQueryAdapter"],
};
