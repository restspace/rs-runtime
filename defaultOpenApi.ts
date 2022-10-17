export const defaultOpenApi = {
	store: {
		file: {
			responses: {
				get: {
					description: "read the item at this servicePath",
					responses: {
						"200": {
							description: "returns the item"
						},
						"404": {
							description: "there is no item at this servicePath"
						}
					}
				},
				post: {
					description: "write the item at this servicePath, and get the written item as a response",
					responses: {
						"200": {
							description: "The item was updated successfully, response is the item as updated"
						},
						"201": {
							description: "The item was created successfully, response is the item as created"
						}
					}
				},
				put: {
					description: "write the item at this servicePath, and get the written item as a response",
					responses: {
						"200": {
							description: "The item was updated successfully, response is the item as updated"
						},
						"201": {
							description: "The item was created successfully, response is the item as created"
						}
					}
				},
				delete: {
					description: "delete the item at this servicePath",
					responses: {
						"200": {
							description: "The item was deleted successfully"
						},
						"404": {
							description: "There was no item to delete at this servicePath"
						}
					}
				}
			},
			parameters: {
				name: "servicePath",
				in: "path",
				description: "multi-segment folder path", 
				required: true,
				schema: {
					type: "array",
					items: {
						type: "string"
					},
					style: "simple",
					"x-multiSegment": true
				}
			}
		}
	},
	components: {
		parameters: {
			
		}
	}
}