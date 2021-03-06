import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";

config.server = testServerConfig;

testServicesConfig['template'] = JSON.parse(`{
    "services": {
        "/templates": {
            "name": "Templates",
            "source": "./services/template.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "outputMime": "text/html",
            "adapterSource": "./adapter/NunjucksTemplateAdapter.ram.json",
            "store": {
                "infraName": "localStore",
                "adapterConfig": {
                    "basePath": "/templates"
                },
                "extension": "njk"
            }
        }
    }
}`);

const { testMessage } = utilsForHost("template");

Deno.test("template", async () => {
    let msg = testMessage("/templates/test", "PUT");
    const template = "<div>{{ val }}</div>";
    msg.setData(template, "text/html");
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);

    msg = testMessage("/templates/test", "GET");
    msgOut = await handleIncomingRequest(msg);
    let txt = await msgOut.data?.asString();
    assertEquals(txt, template);

    msg = testMessage("/templates/test", "POST");
    msg.setDataJson({ val: "hello" });
    msgOut = await handleIncomingRequest(msg);
    txt = await msgOut.data?.asString();
    assertEquals(txt, "<div>hello</div>");

    msg = testMessage("/templates/test", "DELETE");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);

    msg = testMessage("/templates/test", "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 404);
});