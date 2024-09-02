export default {
    "name": "Log Reader Service",
    "description": "Queries a log store for log information",
    "moduleUrl": "./services/logReader.ts",
    "apis": [ "directory", "log-reader" ],
    "adapterInterface": "ILogReaderAdapter"
}