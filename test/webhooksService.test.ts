import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";

config.server = testServerConfig;

testServicesConfig['webhooks'] = JSON.parse(`{
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
        }
    }
}`);

const { testMessage, setDomainHandler } = utilsForHost("webhooks");

async function hmacSha256Hex(secret: string, data: string) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.test("webhooks registry and dispatch", async () => {
    const ep = `/order/created-${crypto.randomUUID().slice(0, 8)}`;
    // Mock external hooks domain
    const calls: { path: string, ts: string, sig: string, body: string, evt: string, rsevt: string, ctype: string }[] = [];
    setDomainHandler("hooks.example.com", (msg) => {
        calls.push({
            path: "/" + msg.url.servicePath,
            ts: msg.getHeader('X-Webhook-Timestamp') || '',
            sig: msg.getHeader('X-Webhook-Signature') || '',
            body: msg.data?.asStringSync() || '',
            evt: msg.getHeader('X-Webhook-Event') || '',
            rsevt: msg.getHeader('X-Restspace-Event') || '',
            ctype: msg.getHeader('content-type') || ''
        });
    });

    // Register two endpoints
    let msg = testMessage("/webhooks", "POST");
    msg.setDataJson({ event: ep, url: "https://hooks.example.com/a", secret: "s1" });
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);

    msg = testMessage("/webhooks", "POST");
    msg.setDataJson({ event: ep, url: "https://hooks.example.com/b", secret: "s2" });
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);

    // Duplicate registration (case-insensitive URL) should 409
    msg = testMessage("/webhooks", "POST");
    msg.setDataJson({ event: ep, url: "HTTPS://HOOKS.EXAMPLE.COM/a", secret: "s3" });
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 409);

    // Dispatch an event
    const payload = { id: "123", total: 49.99 };
    msg = testMessage(`/webhooks${ep}` as string, "POST");
    msg.setDataJson(payload);
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 202);
    const resp = await msgOut.data?.asJson() as any;
    assertEquals(resp.count, 2);
    assertEquals(resp.results.length, 2);

    // Verify two external calls were made with correct headers and signature
    assertEquals(calls.length, 2);
    // both events should be tagged with the dynamic event path
    calls.forEach(c => {
        assertEquals(c.evt, ep);
        assertEquals(c.rsevt, ep);
        assertEquals(c.ctype.startsWith('application/json'), true);
    });

    const bodyStr = JSON.stringify(payload);
    // Calls can arrive in any order; map by path
    const byPath: Record<string, typeof calls[number]> = Object.fromEntries(calls.map(c => [ c.path, c ]));
    const cA = byPath['/a'];
    const cB = byPath['/b'];
    const expectedSigA = 'sha256=' + await hmacSha256Hex('s1', `${cA.ts}.${bodyStr}`);
    const expectedSigB = 'sha256=' + await hmacSha256Hex('s2', `${cB.ts}.${bodyStr}`);
    assertEquals(cA.sig, expectedSigA);
    assertEquals(cB.sig, expectedSigB);
});

Deno.test("webhooks dispatch with no registrants returns empty results", async () => {
    const ep2 = `/order/updated-${crypto.randomUUID().slice(0, 8)}`;
    const calls: any[] = [];
    setDomainHandler("hooks.example.com", (msg) => { calls.push(msg.url.toString()); });

    const msg = testMessage(`/webhooks${ep2}`, "POST");
    msg.setDataJson({ id: "999" });
    const msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 202);
    const resp = await msgOut.data?.asJson() as any;
    assertEquals(resp.count, 0);
    assertEquals(Array.isArray(resp.results) && resp.results.length === 0, true);
});