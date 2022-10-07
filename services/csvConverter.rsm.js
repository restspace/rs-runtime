export default {
    "name": "CSV converter",
    "description": "Convert CSV files to and from JSON or NDJSON",
    "moduleUrl": "./services/csvConverter.ts",
    "apis": [ ],
    "isFilter": true,
	"configSchema": {
        "type": "object",
        "properties": {
            "lineSchema": { "type": "object", "description": "A JSON Schema for a line of the CSV file, object type specifying fieldnames as properties", "properties": {} }
        }
    },
    "exposedConfigProperties": [ "lineSchema" ]
}