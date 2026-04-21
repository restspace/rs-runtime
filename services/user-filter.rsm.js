export default {
  "name": "User filter",
  "description": "Manage passwords and restrict illegal operations to users",
  "moduleUrl": "./services/user-filter.ts",
  "apis": [],
  "isFilter": true,
  "configSchema": {
    "type": "object",
    "properties": {
      "passwordPolicy": {
        "type": "object",
        "description": "Password strength policy for user password writes",
        "properties": {
          "minLength": {
            "type": "number",
            "description": "Minimum password length (default 8)",
          },
          "requiredNumbers": {
            "type": "number",
            "description": "Minimum number of ASCII digits 0-9 (default 0)",
          },
          "requiredSymbols": {
            "type": "number",
            "description":
              "Minimum number of non-alphanumeric ASCII symbols (default 0)",
          },
        },
      },
    },
  },
};
