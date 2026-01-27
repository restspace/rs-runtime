import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { totpCodeFromSecretBase32 } from "../auth/totp.ts";

config.server = testServerConfig;

// Deterministic-enough key for tests; must be base64 for >= 32 bytes.
Deno.env.set("RS_TOTP_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

testServicesConfig["totpAuth"] = JSON.parse(`{
    "services": {
        "/auth": {
            "name": "Auth",
            "source": "./services/auth.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}",
            "sessionTimeoutMins": 30,
            "mfa": { "mode": "challenge", "totpServiceUrl": "/mfa", "mfaTimeoutMins": 5 }
        },
        "/mfa": {
            "name": "MFA",
            "source": "./services/totp.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}",
            "issuer": "restspace.local"
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
                    "password": { "type": "password" },
                    "mfaEnabled": { "type": "boolean" },
                    "totp": { "type": "object" }
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
                    "password": { "type": "password" },
                    "mfaEnabled": { "type": "boolean" },
                    "totp": { "type": "object" }
                },
                "required": [ "email" ],
                "pathPattern": "${"${email}"}"
            }
        }
    }
}`);

const { testMessage, writeJson } = utilsForHost("totpAuth");

function getCookieValue(setCookieHeader: string | null, cookieName: string): string {
    if (!setCookieHeader) return "";
    const idx = setCookieHeader.indexOf(`${cookieName}=`);
    if (idx < 0) return "";
    const rest = setCookieHeader.slice(idx + cookieName.length + 1);
    return rest.split(";")[0];
}

function extractSecretFromOtpAuthUrl(otpauthUrl: string): string {
    const u = new URL(otpauthUrl);
    return u.searchParams.get("secret") || "";
}

Deno.test("auth challenge flow: login -> rs-mfa -> totp -> rs-auth", async () => {
    const user = new AuthUser({
        email: "totp.user@restspace.local.json",
        password: "hello",
        roles: "U"
    });
    await user.hashPassword();
    await writeJson(`/user-bypass/${user.email}`, user, "failed to write user");

    // Normal login (no MFA yet)
    const login1 = testMessage("/auth/login", "POST")
        .setDataJson({ email: user.email, password: "hello" });
    const login1Out = await handleIncomingRequest(login1);
    assert(login1Out.ok, "failed to log in");
    const rsAuth1 = getCookieValue(login1Out.getHeader("Set-Cookie") || null, "rs-auth");
    assert(rsAuth1, "expected rs-auth cookie");

    // Enroll TOTP
    const enroll = testMessage("/mfa/enroll", "POST");
    enroll.cookies["rs-auth"] = rsAuth1;
    const enrollOut = await handleIncomingRequest(enroll);
    assert(enrollOut.ok, "failed to enroll totp");
    const enrollJson = await enrollOut.data!.asJson();
    const secret = extractSecretFromOtpAuthUrl(enrollJson.otpauthUrl);
    assert(secret, "missing secret in otpauth url");

    // Convenience page: should return HTML with an inline SVG QR code.
    const enrollPage = testMessage("/mfa/enroll-page", "GET");
    enrollPage.cookies["rs-auth"] = rsAuth1;
    const enrollPageOut = await handleIncomingRequest(enrollPage);
    assert(enrollPageOut.ok, "failed to load enroll page");
    const enrollPageHtml = (await enrollPageOut.data!.asString()) || "";
    assert(enrollPageHtml.includes("<svg"), "enroll page should include svg qr code");

    // Confirm TOTP
    const code = await totpCodeFromSecretBase32(secret);
    const confirm = testMessage("/mfa/confirm", "POST").setDataJson({ code });
    confirm.cookies["rs-auth"] = rsAuth1;
    const confirmOut = await handleIncomingRequest(confirm);
    assert(confirmOut.ok, "failed to confirm totp");

    // Login should now require MFA and set rs-mfa
    const login2 = testMessage("/auth/login", "POST")
        .setDataJson({ email: user.email, password: "hello" });
    const login2Out = await handleIncomingRequest(login2);
    assertEquals(login2Out.status, 202);
    const rsMfa = getCookieValue(login2Out.getHeader("Set-Cookie") || null, "rs-mfa");
    assert(rsMfa, "expected rs-mfa cookie");
    const mfaPayload = await config.authoriser.verifyJwtHeader("", rsMfa, "/");
    assert(typeof mfaPayload !== "string", "expected rs-mfa to verify as JWT");
    assertEquals((mfaPayload as any).mfaPending, true);
    const mfaPayloadPath = await config.authoriser.verifyJwtHeader("", rsMfa, "/auth/mfa/totp");
    assert(typeof mfaPayloadPath !== "string", "expected rs-mfa to verify for /auth/mfa/totp path");
    const login2Json = await login2Out.data!.asJson();
    assertEquals(login2Json.mfaRequired, true);

    // Sanity: TOTP verify endpoint works with internalPrivilege.
    const directVerify = testMessage("/mfa/verify", "POST").setDataJson({
        email: user.email,
        code: await totpCodeFromSecretBase32(secret)
    });
    directVerify.internalPrivilege = true;
    const directVerifyOut = await handleIncomingRequest(directVerify);
    assert(directVerifyOut.ok, "direct /mfa/verify should succeed");

    // Complete MFA to obtain rs-auth
    const complete = testMessage("/auth/mfa/totp", "POST").setDataJson({ code: await totpCodeFromSecretBase32(secret) });
    complete.cookies["rs-mfa"] = rsMfa;
    assert(complete.getCookie("rs-mfa"), "test request should carry rs-mfa cookie");
    const completeOut = await handleIncomingRequest(complete);
    assert(completeOut.ok, "mfa completion failed");
    const rsAuth2 = getCookieValue(completeOut.getHeader("Set-Cookie") || null, "rs-auth");
    assert(rsAuth2, "expected rs-auth cookie after mfa");
    const completeJson = await completeOut.data!.asJson();
    assert(!("secretEnc" in (completeJson.totp || {})), "should not leak secretEnc");
    assertEquals(typeof completeJson.totp?.enabled, "boolean");
});

