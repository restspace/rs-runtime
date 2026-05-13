export default {
    "name": "S3 File Adapter",
    "description": "Reads and writes files on the AWS S3",
    "moduleUrl": "./adapter/S3FileAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "rootPath": { "type": "string", "description": "Object key prefix below the tenant storage root" },
            "bucketName": { "type": "string" },
            "region": { "type": "string" },
            "tenantDirectories": { "type": "boolean", "description": "Deprecated; tenant directories are now always applied" },
            "secretAccessKey": { "type": "string" },
            "ec2IamRole": { "type": "string", "description": "If running on EC2 with an associated IAM role, this can be provided instead of account keys" },
            "accessKeyId": { "type": "string" }
        },
        "required": [ "rootPath", "bucketName", "region" ]
    },
    "adapterInterfaces": [ "IFileAdapter", "IDataAdapter" ]
}
