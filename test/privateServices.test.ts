import { assert, assertStrictEquals } from "std/testing/asserts.ts";
import { Message } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { mockHandler } from "../services/mock.ts";
import { testServerConfig } from "./testServerConfig.ts";

config.server = testServerConfig;

testServicesConfig['privateServices'] = JSON.parse(`{
    "services": {
        "/": {
            "name": "Mock",
            "source": "./services/privateServicesMock.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        }
    }
}`);

mockHandler.getJson("/ps/xyz", "xyz result");

function testMessage(url: string, method: string) {
    const msg = new Message(url, 'privateServices', method)
        .setHeader('host', 'privateServices.restspace.local:3100');
    return msg;
}

Deno.test("simple private services", async () => {
    const msg = testMessage("/ps/xyz", "GET");
    const msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed");
    const res = await msgOut?.data?.asJson();
    assertStrictEquals(res, "xyz result");
});