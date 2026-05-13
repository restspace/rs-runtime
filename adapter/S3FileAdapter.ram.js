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
            "tenantDirectories": { "type": "boolean", "description": "When true or omitted, S3 object keys are prefixed with the safe tenant path segment. When false, no tenant path segment is inserted; use only for tenant-specific buckets or root paths." },
            "secretAccessKey": { "type": "string" },
            "ec2IamRole": { "type": "string", "description": "If running on EC2 with an associated IAM role, this can be provided instead of account keys" },
            "accessKeyId": { "type": "string" }
        },
        "required": [ "rootPath", "bucketName", "region" ]
    },
    "infraOnlyConfigProperties": [ "tenantDirectories" ],
    "adapterInterfaces": [ "IFileAdapter", "IDataAdapter" ]
}
