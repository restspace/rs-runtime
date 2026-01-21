import { IServiceManifest } from "rs-core/IManifest.ts"

export const storeApi = (manifest: IServiceManifest) => {
    return {
        description: manifest.description,
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
                    description: "The item was not found"
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
    };
}

export const transformApi = (manifest: IServiceManifest) => {
    return {
        description: manifest.description,
        post: {
            description: "transform the posted data",
            responses: {
                "200": {
                    description: "returns transformed data"
                },
                "400": {
                    description: "invalid input"
                }
            }
        }
    };
}

export const viewApi = (manifest: IServiceManifest) => {
    return {
        description: manifest.description,
        get: {
            description: "read the view output",
            responses: {
                "200": {
                    description: "returns view data"
                },
                "404": {
                    description: "view not found"
                }
            }
        }
    };
}

export const operationApi = (manifest: IServiceManifest) => {
    return {
        description: manifest.description,
        post: {
            description: "execute the operation",
            responses: {
                "200": {
                    description: "operation completed"
                },
                "400": {
                    description: "invalid input"
                }
            }
        },
        put: {
            description: "execute the operation",
            responses: {
                "200": {
                    description: "operation completed"
                },
                "400": {
                    description: "invalid input"
                }
            }
        }
    };
}
