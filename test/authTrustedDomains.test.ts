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

function getCookieValue(setCookieHeader: string | null | undefined, cookieName: string): string {
    const setCookie = setCookieHeader || "";
    const idx = setCookie.indexOf(`${cookieName}=`);
    if (idx < 0) return "";
    const rest = setCookie.slice(idx + cookieName.length + 1);
    return rest.split(";")[0];
}

async function loginWithCookie(email: string, origin = "http://trustedDomains.restspace.local:3100") {
    await createUser(email);
    const loginMsg = testMessage("/auth/login", "POST")
        .setHeader("origin", origin)
        .setDataJson({ email, password: "hello" });
    const loginOut = await handleIncomingRequest(loginMsg);
    assert(loginOut.ok, "failed to log in");
    const token = getCookieValue(loginOut.getHeader("Set-Cookie"), "rs-auth");
    assert(token, "expected rs-auth cookie");
    return token;
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
    assertEquals(loginOut.getHeader("Access-Control-Allow-Credentials"), "true");

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
    assertEquals(loginOut.getHeader("Access-Control-Allow-Credentials"), undefined);

    const body = await loginOut.data?.asJson();
    assert(typeof (body as any)?._jwt === "string", "expected _jwt in response body");
});

Deno.test("cookie auth from exact origin gets credentialed CORS", async () => {
    const token = await loginWithCookie("exact.origin.cors@restspace.local.json");

    const userMsg = testMessage("/auth/user", "GET", token);
    const userOut = await handleIncomingRequest(userMsg);

    assert(userOut.ok, "expected auth user request to succeed");
    assertEquals(userOut.getHeader("Access-Control-Allow-Origin"), "http://trustedDomains.restspace.local:3100");
    assertEquals(userOut.getHeader("Access-Control-Allow-Credentials"), "true");
    assertEquals(userOut.getHeader("Vary"), "Origin");
});

Deno.test("cookie auth from trusted domain gets credentialed CORS", async () => {
    const email = "trusted.domain.cors@restspace.local.json";
    await createUser(email);

    const loginMsg = testMessage("/auth/login", "POST")
        .setHeader("origin", "https://app.trusted.example.com")
        .setHeader("x-forwarded-proto", "https")
        .setDataJson({ email, password: "hello" });
    const loginOut = await handleIncomingRequest(loginMsg);
    assert(loginOut.ok, "failed to log in");
    const token = getCookieValue(loginOut.getHeader("Set-Cookie"), "rs-auth");
    assert(token, "expected rs-auth cookie");

    const userMsg = testMessage("/auth/user", "GET", token)
        .setHeader("origin", "https://app.trusted.example.com")
        .setHeader("x-forwarded-proto", "https");
    const userOut = await handleIncomingRequest(userMsg);

    assert(userOut.ok, "expected auth user request to succeed");
    assertEquals(userOut.getHeader("Access-Control-Allow-Origin"), "https://app.trusted.example.com");
    assertEquals(userOut.getHeader("Access-Control-Allow-Credentials"), "true");
});

Deno.test("cookie auth from sibling subdomain is not credentialed CORS", async () => {
    const token = await loginWithCookie("sibling.read.cors@restspace.local.json");

    const userMsg = testMessage("/auth/user", "GET", token)
        .setHeader("origin", "http://evil.restspace.local:3100");
    const userOut = await handleIncomingRequest(userMsg);

    assert(userOut.ok, "expected server-side request to still succeed");
    assertEquals(userOut.getHeader("Access-Control-Allow-Origin"), "http://evil.restspace.local:3100");
    assertEquals(userOut.getHeader("Access-Control-Allow-Credentials"), undefined);
});

Deno.test("cookie auth from sibling subdomain is rejected for unsafe methods", async () => {
    const token = await loginWithCookie("sibling.write.cors@restspace.local.json");

    const logoutMsg = testMessage("/auth/logout", "POST", token)
        .setHeader("origin", "http://evil.restspace.local:3100");
    const logoutOut = await handleIncomingRequest(logoutMsg);

    assertEquals(logoutOut.status, 403);
    assertEquals(logoutOut.getHeader("Access-Control-Allow-Origin"), "http://evil.restspace.local:3100");
    assertEquals(logoutOut.getHeader("Access-Control-Allow-Credentials"), undefined);
});

Deno.test("authorization auth from untrusted domain keeps broad non-credentialed CORS", async () => {
    const email = "bearer.cors@restspace.local.json";
    await createUser(email);

    const loginMsg = testMessage("/auth/login", "POST")
        .setHeader("origin", "https://app.untrusted.example.com")
        .setHeader("x-forwarded-proto", "https")
        .setDataJson({ email, password: "hello" });
    const loginOut = await handleIncomingRequest(loginMsg);
    assert(loginOut.ok, "failed to log in");
    const loginBody = await loginOut.data?.asJson();
    const token = (loginBody as any)?._jwt;
    assert(typeof token === "string", "expected _jwt in response body");

    const userMsg = testMessage("/auth/user", "GET")
        .setHeader("origin", "https://app.untrusted.example.com")
        .setHeader("authorization", `Bearer ${token}`);
    const userOut = await handleIncomingRequest(userMsg);

    assert(userOut.ok, "expected bearer auth user request to succeed");
    assertEquals(userOut.getHeader("Access-Control-Allow-Origin"), "https://app.untrusted.example.com");
    assertEquals(userOut.getHeader("Access-Control-Allow-Credentials"), undefined);
});
