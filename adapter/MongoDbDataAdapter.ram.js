export default {
  "name": "MongoDB Data Adapter",
  "description":
    "Reads and writes data to tenant-scoped MongoDB-compatible databases (MongoDB Atlas/local, Amazon DocumentDB)",
  "moduleUrl": "./adapter/MongoDbDataAdapter.ts",
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
      "schemaCollection": {
        "type": "string",
        "description":
          "Optional collection name for schema storage inside the tenant database (default _schemas)",
      },
    },
    "required": ["url"],
  },
  "adapterInterfaces": ["IDataAdapter", "ISchemaAdapter"],
};
