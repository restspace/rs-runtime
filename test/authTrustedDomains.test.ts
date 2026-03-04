import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import { AuthUser } from "../auth/AuthUser.ts";

config.server = testServerConfig;

testServicesConfig["trustedDomains"] = JSON.parse(`{
    "services": {
        "/auth": {
            "name": "Auth",
            "source": "./services/auth.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}",
            "trustedDomains": [ "*.trusted.example.com" ]
        },
        "/user": {
            "name": "User",
            "source": "./services/user-data.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "infraName": "localStore",
            "adapterConfig": { "basePath": "/data/user" },
            "datasetName": "user",
            "schema": {
                "type": "object",
                "properties": {
                    "email": { "type": "string" },
                    "roles": { "type": "string" },
                    "password": { "type": "password" }
                },
                "required": [ "email" ],
                "pathPattern": "${"${email}"}"
            }
        },
        "/user-bypass": {
            "name": "User bypass",
            "source": "./services/dataset.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "infraName": "localStore",
            "adapterConfig": { "basePath": "/data/user" },
            "datasetName": "user",
            "schema": {
                "type": "object",
                "properties": {
                    "email": { "type": "string" },
                    "roles": { "type": "string" },
                    "password": { "type": "password" }
                },
                "required": [ "email" ],
                "pathPattern": "${"${email}"}"
            }
        }
    }
}`);

const { testMessage, writeJson } = utilsForHost("trustedDomains");

async function createUser(email: string) {
    const user = new AuthUser({
        email,
        password: "hello",
        roles: "U"
    });
    await user.hashPassword();
    await writeJson(`/user-bypass/${user.email}`, user, "failed to write user");
}

Deno.test("auth login from trusted domain sets SameSite=None", async () => {
    const email = "trusted.login@restspace.local.json";
    await createUser(email);

    const loginMsg = testMessage("/auth/login", "POST")
        .setHeader("origin", "https://app.trusted.example.com")
        .setHeader("x-forwarded-proto", "https")
        .setDataJson({ email, password: "hello" });
    const loginOut = await handleIncomingRequest(loginMsg);
    assert(loginOut.ok, "failed to log in");

    const setCookie = loginOut.getHeader("Set-Cookie") || "";
    assert(setCookie.includes("rs-auth="), "expected rs-auth cookie");
    assert(setCookie.includes("SameSite=None"), `expected SameSite=None, got: ${setCookie}`);
    assert(setCookie.includes("Secure"), `expected Secure cookie, got: ${setCookie}`);

    const body = await loginOut.data?.asJson();
    assertEquals((body as any)?._jwt, undefined);
});

Deno.test("auth login from non-trusted cross-domain keeps JWT response body", async () => {
    const email = "untrusted.login@restspace.local.json";
    await createUser(email);

    const loginMsg = testMessage("/auth/login", "POST")
        .setHeader("origin", "https://app.untrusted.example.com")
        .setHeader("x-forwarded-proto", "https")
        .setDataJson({ email, password: "hello" });
    const loginOut = await handleIncomingRequest(loginMsg);
    assert(loginOut.ok, "failed to log in");

    assertEquals(loginOut.getHeader("Set-Cookie") || "", "");

    const body = await loginOut.data?.asJson();
    assert(typeof (body as any)?._jwt === "string", "expected _jwt in response body");
});
