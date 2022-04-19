export default {
    "name": "AWS 4 Proxy Adapter",
    "description": "Forwards a request to a configured path pattern after signing using AWS-4 signature",
    "moduleUrl": "./adapter/AWS4ProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "service": { "type": "string", "description": "AWS service e.g. s3" },
            "region": { "type": "string", "description": "AWS region e.g. eu-west-1" },
            "secretAccessKey": { "type": "string", "description": "AWS account keys, secret" },
            "accessKeyId": { "type": "string", "description": "AWS account keys, public access" },
            "urlPattern": { "type": "string", "description": "AWS endpoint url pattern" }
        },
        "required": [ "urlPattern" ]
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}