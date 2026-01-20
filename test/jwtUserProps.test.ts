import { assert, assertEquals } from "std/testing/asserts.ts";
import { Message } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import authService from "../services/auth.ts";

config.server = testServerConfig;

testServicesConfig["jwtProps"] = JSON.parse(`{
    "services": {
        "/auth": {
            "name": "Auth",
            "source": "./services/auth.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}",
            "jwtUserProps": [ "organisationId", "password" ]
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
                    "organisationId": { "type": "string" }
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
                    "organisationId": { "type": "string" }
                },
                "required": [ "email" ],
                "pathPattern": "${"${email}"}"
            }
        }
    }
}`);

const { testMessage, writeJson } = utilsForHost("jwtProps");

Deno.test("auth login embeds configured jwtUserProps (safe) in JWT", async () => {
    const user = new AuthUser({
        email: "test.user@restspace.local.json",
        password: "hello",
        roles: "U",
        organisationId: "org-123"
    });
    await user.hashPassword();

    await writeJson(`/user-bypass/${user.email}`, user, "failed to write user");

    const loginMsg = testMessage("/auth/login", "POST")
        .setDataJson({ email: user.email, password: "hello" });
    const loginOut = await handleIncomingRequest(loginMsg);
    assert(loginOut.ok, "failed to log in");

    let token = loginOut.getHeader("Set-Cookie")?.replace("rs-auth=", "");
    assert(token, "no set auth cookie");
    token = token.split(";")[0];

    const payload = await config.authoriser.verifyJwtHeader("", token, "/");
    assert(typeof payload !== "string", "expected jwt payload");
    assertEquals(payload.organisationId, "org-123");
    assertEquals(payload.password, undefined);
});

Deno.test("auth refresh preserves jwtUserProps but never includes blocked fields", async () => {
    const initialPayload = {
        email: "refresh.user@restspace.local",
        roles: "U",
        organisationId: "org-999",
        password: "leak"
    };

    const token = await config.authoriser.getJwtForPayload(initialPayload, 10);

    const msg = new Message("http://jwtProps.restspace.local:3100/anything", "jwtProps", "GET", null);
    msg.cookies["rs-auth"] = token;

    const out = await authService.setUserFunc(msg, {} as any, {
        sessionTimeoutMins: 1,
        jwtUserProps: [ "organisationId", "password" ]
    } as any);

    let refreshed = out.getHeader("Set-Cookie")?.replace("rs-auth=", "");
    assert(refreshed, "no refreshed auth cookie");
    refreshed = refreshed.split(";")[0];

    const refreshedPayload = await config.authoriser.verifyJwtHeader("", refreshed, "/");
    assert(typeof refreshedPayload !== "string", "expected refreshed jwt payload");
    assertEquals(refreshedPayload.organisationId, "org-999");
    assertEquals(refreshedPayload.password, undefined);
});

