export default {
    "name": "Local File Log Reader Adapter",
    "description": "Scans a log file on the local file system",
    "moduleUrl": "./adapter/FileLogReaderAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "logPath": { "type": "string", "description": "Full system file path to log file" }
        }
    },
    "adapterInterfaces": [ "ILogReaderAdapter" ]
}