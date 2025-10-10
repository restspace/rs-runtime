export default {
  "name": "Private Caller",
  "description": "Calls private services directly from handler",
  "moduleUrl": "./services/private-caller.ts",
  "apis": [ ],
  "privateServices": {
    "serv1": {
      "name": "'Serv 1'",
      "source": "./services/mock.rsm.json",
      "access": { "readRoles": "'all'", "writeRoles": "'all'" }
    }
  }
}