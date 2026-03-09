import { assertEquals } from "std/testing/asserts.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";

config.server = testServerConfig;

testServicesConfig["lib-service"] = {
    services: {
        "/lib": {
            name: "Lib",
            source: "./services/lib.rsm.json",
            basePath: "/lib",
            access: { readRoles: "all", writeRoles: "all" }
        }
    }
};

const { testMessage } = utilsForHost("lib-service");

Deno.test("lib/set-status uses provided message body", async () => {
    const msg = testMessage("/lib/set-status/418/short%20and%20stout", "POST");
    const msgOut = await handleIncomingRequest(msg);

    assertEquals(msgOut.status, 418);
    assertEquals(await msgOut.data?.asString(), "short and stout");
});

Deno.test("lib/set-status uses the standard http message when omitted", async () => {
    const msg = testMessage("/lib/set-status/404", "POST");
    const msgOut = await handleIncomingRequest(msg);

    assertEquals(msgOut.status, 404);
    assertEquals(await msgOut.data?.asString(), "Not Found");
});
