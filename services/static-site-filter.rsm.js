export default {
	"name": "Static site filter",
    "description": "Provide static site behaviour with options suitable for hosting SPAs",
    "moduleUrl": "./services/static-site-filter.ts",
    "apis": [ ],
	"isFilter": true,
    "configSchema": {
        "type": "object",
        "properties": {
            "divertMissingToDefault": { "type": "boolean", "description": "Divert a 404 Not Found to the default file, needed for JS routing" },
            "defaultResource": { "type": "string", "description": "Name of the resource served to /base-path/" }
        }
    }
}