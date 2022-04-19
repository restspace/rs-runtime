import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";

config.server = testServerConfig;

testServicesConfig['staticSite'] = JSON.parse(`{
    "services": {
        "/admin": {
            "name": "Site",
            "source": "./services/static-site.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "infraName": "localStore",
            "adapterConfig": {
                "basePath": "/site"
            },
            "divertMissingToDefault": true,
            "defaultResource": "index.json"
        }
    }
}`);

const { testMessage, writeJson } = utilsForHost("staticSite");

Deno.test("static site", async () => {
    let msgOut = await writeJson("/admin/index.json", { data: "hello" }, "failed to write index.json");
    msgOut = await writeJson("/admin/test/test.json", { data: "test" }, "failed to write test.json");
    

    let msg = testMessage("/admin", "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 0, "failed to divert root to root directory");
    let val = await msgOut.data?.asJson(); // don't leave an unread message, it has an open file handle associate with it

    msg = testMessage("/admin/", "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 0, "Failed to read root directory (as default resource)");
    val = await msgOut.data?.asJson();

    msg = testMessage("/admin/rubbish-url", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to redirect to default");
    let d = await msgOut.data?.asJson();
    assertEquals(d, { data: "hello" }, "bad data when redirected to default");

    msg = testMessage("/admin/test/test.json", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read other site file");
    d = await msgOut.data?.asJson();
    assertEquals(d, { data: "test" }, "bad data when reading other site file");
});