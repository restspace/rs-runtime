export default {
  "name": "User data service",
  "description": "Manages access to and stores user data",
  "moduleUrl": "./services/dataset.ts",
  "apis": ["store", "data.set"],
  "adapterInterface": "IDataAdapter",
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
  "prePipeline": ["$METHOD *userFilter/$P*"],
  "postPipeline": ["$METHOD *userFilter/$P*"],
  "privateServices": {
    "userFilter": {
      "name": "'User filter'",
      "access": { "readRoles": "'all'", "writeRoles": "'all'" },
      "source": "./services/user-filter.rsm.json",
      "passwordPolicy": "passwordPolicy",
    },
  },
};
