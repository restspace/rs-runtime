export default {
    "name": "Local File Adapter",
    "description": "Reads and writes files on the file system local to the runtime",
    "moduleUrl": "./adapter/LocalFileAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "rootPath": { "type": "string", "description": "File path to root of all file storage" },
            "basePath": { "type": "string", "description": "Path below root path to storage for this service (generally unique)" },
            "lockTimeoutMs": { "type": "integer", "minimum": 0, "description": "Default max time in ms to wait in the lock queue before failing with 423 (0 = wait indefinitely)" },
            "readLockTimeoutMs": { "type": "integer", "minimum": 0, "description": "Optional override of lockTimeoutMs for read operations" },
            "writeLockTimeoutMs": { "type": "integer", "minimum": 0, "description": "Optional override of lockTimeoutMs for write/delete/move operations" }
        }
    },
    "adapterInterfaces": [ "IFileAdapter", "IDataAdapter" ]
}