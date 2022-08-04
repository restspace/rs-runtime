export default {
    "name": "Pipeline",
    "description": "A pipeline of urls acting as request processors in parallel or serial",
    "moduleUrl": "./services/pipeline.ts",
    "apis": [ "transform", "pipeline" ],
	"configSchema": {
		"$id": "http://restspace.io/services/pipeline",
		"definitions": {
			"pipeline": {
				"type": "array",
				"items": {
					"type": [ "string", "array", "object" ],
					"oneOf": [
						{ "title": "request", "type": "string" },
						{ "title": "subpipeline", "$ref": "#/definitions/pipeline" },
						{ "title": "transform", "type": "object" }
					],
					"editor": "oneOfRadio"
				}
			}
		},
		"type": "object",
		"properties": {
			"pipeline": { "$ref": "#/definitions/pipeline" },
			"manualMimeTypes": {
				"type": "object",
				"properties": {
					"requestMimeType": { "type": "string" },
					"requestSchema": { "type": "object" },
					"responseMimeType": { "type": "string" },
					"responseSchema": { "type": "object" }
				}
			}
		}
	}
}