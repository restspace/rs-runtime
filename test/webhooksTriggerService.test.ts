import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";

config.server = testServerConfig;

// Tenant with webhooks server, webhooks-trigger client store and a generic data service for callback side-effects
// - /webhooks: registry and dispatcher backed by /data/webhooks
// - /subs: webhooks-trigger store backed by /data/subs
// - /data: generic data service on /data for test verification of pipeline writes

testServicesConfig['webhooksTrigger'] = JSON.parse(`{
    "services": {
        "/lib": {
            "name": "Lib",
            "source": "./services/lib.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/webhooks": {
            "name": "Webhooks",
            "source": "./services/webhooks.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "concurrency": 4,
            "retryCount": 0,
            "store": {
                "infraName": "localStore",
                "adapterConfig": {
                    "basePath": "/data/webhooks"
                }
            }
        },
        "/subs": {
            "name": "Webhooks Trigger Store",
            "source": "./services/webhooks-trigger.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "store": {
                "infraName": "localStore",
                "adapterConfig": {
                    "basePath": "/data/subs"
                }
            }
        },
        "/data": {
            "name": "Data",
            "source": "./services/data.rsm.json",
            "infraName": "localStore",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "adapterConfig": {
                "basePath": "/data"
            }
        }
    }
}`);

const { testMessage } = utilsForHost("webhooksTrigger");

Deno.test("webhooks-trigger registers on manage write and executes pipeline on callback", async () => {
    const ep = `/order/created-${crypto.randomUUID().slice(0, 8)}`;
    const subKey = `sub-${crypto.randomUUID().slice(0, 8)}`;
    const cbKey = `cb-${crypto.randomUUID().slice(0, 8)}`;

    // Write subscription spec to /subs/<subKey> in manage mode
    let msg = testMessage(`/subs/${subKey}`, "PUT");
    msg.setHeader('X-Restspace-Request-Mode', 'manage');
    msg.setDataJson({
        event: ep,
        secret: "s1",
        pipeline: [ `POST /data/cb/${cbKey}` ]
    });
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);

    // Callback endpoint should reject direct POST without signature
    msg = testMessage(`/subs/${subKey}`, "POST");
    msg.setDataJson({ id: "999" });
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 401);

    // Dispatch event to /webhooks<ep>
    const payload = { id: "123", total: 49.99 };
    msg = testMessage(`/webhooks${ep}`, "POST");
    msg.setDataJson(payload);
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 202);

    // Verify pipeline wrote callback payload to /data/cb/<cbKey>
    msg = testMessage(`/data/cb/${cbKey}`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);
    const saved = await msgOut.data?.asJson() as any;
    assertEquals(saved, payload);
});