export default {
    "name": "S3 File Adapter",
    "description": "Reads and writes files on the AWS S3",
    "moduleUrl": "./adapter/S3FileAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "rootPath": { "type": "string" },
            "bucketName": { "type": "string" },
            "region": { "type": "string" },
            "tenantDirectories": { "type": "boolean" },
            "secretAccessKey": { "type": "string" },
            "accessKeyId": { "type": "string" }
        },
        "required": [ "rootPath", "bucketName", "region" ]
    },
    "adapterInterfaces": [ "IFileAdapter", "IDataAdapter" ]
}