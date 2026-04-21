import { assert, assertEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import { AuthUser } from "../auth/AuthUser.ts";

config.server = testServerConfig;

testServicesConfig["authLockout"] = JSON.parse(`{
    "services": {
        "/auth": {
            "name": "Auth",
            "source": "./services/auth.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}",
            "loginLockout": {
                "maxAttempts": 3,
                "lockMinutes": 10
            }
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
                    "authLockout": { "type": "object" }
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
                    "authLockout": { "type": "object" }
                },
                "required": [ "email" ],
                "pathPattern": "${"${email}"}"
            }
        }
    }
}`);

const { testMessage, writeJson } = utilsForHost("authLockout");

async function createUser(email: string, password = "correct123") {
  const user = new AuthUser({ email, password, roles: "U" });
  await user.hashPassword();
  await writeJson(`/user-bypass/${email}`, user, "failed to write user");
}

async function login(email: string, password: string) {
  const msg = testMessage("/auth/login", "POST")
    .setDataJson({ email, password });
  return await handleIncomingRequest(msg);
}

async function readBypassUser(email: string) {
  const msg = testMessage(`/user-bypass/${email}`, "GET");
  const out = await handleIncomingRequest(msg);
  assert(out.ok, "failed to read user");
  return await out.data!.asJson();
}

Deno.test("auth login lockout: unknown user and bad password use generic 401", async () => {
  const email = "generic.known@restspace.local.json";
  await createUser(email);

  const unknown = await login(
    "generic.unknown@restspace.local.json",
    "wrong123",
  );
  assertEquals(unknown.status, 401);
  assertEquals(await unknown.data?.asString(), "Invalid credentials");

  const badPassword = await login(email, "wrong123");
  assertEquals(badPassword.status, 401);
  assertEquals(await badPassword.data?.asString(), "Invalid credentials");
});

Deno.test("auth login lockout: repeated bad passwords lock a known user", async () => {
  const email = "lock.known@restspace.local.json";
  await createUser(email);

  assertEquals((await login(email, "wrong1")).status, 401);
  assertEquals((await login(email, "wrong2")).status, 401);
  assertEquals((await login(email, "wrong3")).status, 423);

  const lockedUser = await readBypassUser(email);
  assertEquals(lockedUser.authLockout.failedAttempts, 3);
  assert(
    typeof lockedUser.authLockout.lockUntil === "string",
    "lockUntil should be stored",
  );

  const correctDuringLock = await login(email, "correct123");
  assertEquals(correctDuringLock.status, 423);
});

Deno.test("auth login lockout: successful login clears previous failures", async () => {
  const email = "clear.known@restspace.local.json";
  await createUser(email);

  assertEquals((await login(email, "wrong1")).status, 401);
  assertEquals((await login(email, "wrong2")).status, 401);

  let user = await readBypassUser(email);
  assertEquals(user.authLockout.failedAttempts, 2);

  const success = await login(email, "correct123");
  assert(success.ok, "login should succeed before lockout threshold");

  user = await readBypassUser(email);
  assertEquals(user.authLockout, undefined);
});
