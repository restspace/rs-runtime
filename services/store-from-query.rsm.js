export default {
    "name": "Store from Query",
    "description": "For data infrastructure which supports queries, provides a view of the data as a store based on a query",
    "moduleUrl": "./services/store-from-query.ts",
    "apis": [ "store", "data.set" ],
    "adapterInterface": "IQueryAdapter",
    "configSchema": {
        "type": "object",
        "properties": {
            "itemQuery": {
                "type": "string",
                "description": "The query to find a single item based on the url path"
            },
            "listQuery": {
                "type": "string",
                "description": "The query to list all items at the top level"
            },
            "underlyingStoreUrlPattern": {
                "type": "string",
                "description": "The url of the key value store letting you write an item via substituting field(s) from its data"
            }
        },
        "required": [ "itemQuery", "listQuery", "underlyingStoreUrlPattern" ]
    },
    "exposedConfigProperties": [ "itemQuery", "listQuery", "underlyingStoreUrlPattern" ]
}