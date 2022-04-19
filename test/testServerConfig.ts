import { makeServerCorsSetter } from "../getServerConfig.ts";

export const testServerConfig = JSON.parse(`{
    "tenancy": "multi",
    "mainDomain": "restspace.local:3100",
    "domainMap": {
        "shamiyaana.com": "shamiyaana",
        "www.shamiyaana.com": "shamiyaana",
        "schoolofgnostickabbalah.com": "sgk",
        "www.schoolofgnostickabbalah.com": "sgk",
        "schoolofgnostickabbalah.org": "sgk",
        "www.schoolofgnostickabbalah.org": "sgk",
        "test.restspace.io": "test",
        "kaballah.restspace.io": "kaballah"
    },
    "infra": {
        "localDisk": {
            "adapterSource": "./test/TestConfigFileAdapter.ram.json"
        },
        "localStore": {
            "adapterSource": "./adapter/LocalFileAdapter.ram.json",
            "rootPath": "` + 'C:\\\\Dev\\\\test\\\\test-data\\\\${tenant}' + `"
        }
    },
    "configStore": "localDisk"
}`);

testServerConfig.setServerCors = makeServerCorsSetter();