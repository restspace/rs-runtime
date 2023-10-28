import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";

config.server = testServerConfig;

testServicesConfig['proxy'] = JSON.parse(`{
    "services": {
        "/proxy": {
            "name": "Proxy",
            "source": "./services/proxy.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "adapterSource": "./adapter/SimpleProxyAdapter.ram.json",
            "adapterConfig": {
                "urlPattern": "https://www.google.com"
            }
        }
    }
}`);

const { testMessage } = utilsForHost("proxy");

Deno.test("proxy", async () => {
    let msg = testMessage("/proxy", "GET");
    let msgOut = await handleIncomingRequest(msg);
    const body = await msgOut.data?.asString()
    assert(msgOut.ok);
    assertEquals(msgOut.url.path, '/proxy');
});