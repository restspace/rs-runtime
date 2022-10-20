export default {
    "name": "Static site service",
    "description": "Hosts a static site with options suitable for SPA routing",
    "moduleUrl": "./services/file.ts",
    "apis": [ "store", "file.base" ],
    "adapterInterface": "IFileAdapter",
    "prePipeline": [ "$METHOD staticSiteFilter/$*?targetPath=$*&outerUrl=$$" ],
    "configSchema": {
        "type": "object",
        "properties": {
            "divertMissingToDefault": { "type": "boolean", "description": "Divert a 404 Not Found to the default file, needed for JS routing" },
            "defaultResource": { "type": "string", "description": "Name of the resource served to /base-path/" }
        }
    },
    "privateServices": {
        "staticSiteFilter": {
            "name": "'Static site filter'",
            "access": { "readRoles": "'all'", "writeRoles": "'all'" },
            "source": "./services/static-site-filter.rsm.json",
			"infraName": "infraName",
			"adapterConfig": "adapterConfig",
			"adapterSource": "adapterSource",
            "divertMissingToDefault": "divertMissingToDefault"
        }
    }
}