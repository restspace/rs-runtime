export default {
    "name": "SNS SMS Sender Adapter",
    "description": "Sends a SMS message via AWS SNS",
    "moduleUrl": "./adapter/SnsSmsAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "region": { "type": "string" },
            "secretAccessKey": { "type": "string" },
            "ec2IamRole": { "type": "string", "description": "If running on EC2 with an associated IAM role, this can be provided instead of account keys" },
            "accessKeyId": { "type": "string" }
        },
        "required": [ "region" ]
    },
    "adapterInterfaces": [ "ISmsAdapter" ]
}