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
			},
			"reauthenticate": { "type": "boolean", "description": "If true, checks authentication before calling any item of the pipeline" },
			"inputSchema": { "type": "object", "description": "Agent-surface input schema metadata" },
			"outputSchema": { "type": "object", "description": "Agent-surface output schema metadata" },
			"x-agent": { "type": "object", "description": "Agent-surface semantic metadata" },
			"x-policy": { "type": "object", "description": "Agent-surface policy metadata" },
			"x-render": { "type": "object", "description": "Agent-surface render metadata" },
			"x-context": { "type": "object", "description": "Agent-surface context metadata" },
			"x-expose": { "type": "object", "description": "Agent-surface exposure metadata" }
		}
	}
}
