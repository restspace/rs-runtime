export default {
    "name": "Test Config File Adapter",
    "description": "Mock file adapter to read test services.json",
    "moduleUrl": "./test/TestConfigFileAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
        }
    },
    "adapterInterfaces": [ "IFileAdapter" ]
}