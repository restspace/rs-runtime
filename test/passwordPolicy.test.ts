import { assert, assertEquals, assertNotEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { validatePasswordStrength } from "../auth/passwordPolicy.ts";

config.server = testServerConfig;

testServicesConfig["passwordPolicy"] = JSON.parse(`{
    "services": {
        "/auth": {
            "name": "Auth",
            "source": "./services/auth.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}"
        },
        "/account": {
            "name": "Account",
            "source": "./services/account.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${"${email}"}",
            "emailSendUrlPattern": "https://email.com/${"${email}"}",
            "passwordPolicy": {
                "minLength": 8,
                "requiredNumbers": 2,
                "requiredSymbols": 1
            },
            "passwordReset": {
                "tokenExpiryMins": 30,
                "returnPageUrl": "/reset",
                "emailTemplateUrl": "/templates/reset-email"
            }
        },
        "/user": {
            "name": "User",
            "source": "./services/user-data.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "infraName": "localStore",
            "adapterConfig": { "basePath": "/data/user" },
            "datasetName": "user",
            "passwordPolicy": {
                "minLength": 8,
                "requiredNumbers": 2,
                "requiredSymbols": 1
            },
            "schema": {
                "type": "object",
                "properties": {
                    "email": { "type": "string" },
                    "roles": { "type": "string" },
                    "password": { "type": "password" },
                    "token": { "type": "string" },
                    "tokenExpiry": { "type": "string", "format": "date-time" }
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
                    "token": { "type": "string" },
                    "tokenExpiry": { "type": "string", "format": "date-time" }
                },
                "required": [ "email" ],
                "pathPattern": "${"${email}"}"
            }
        },
        "/email": {
            "name": "Email (Mock)",
            "source": "./services/mock.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/templates": {
            "name": "Templates",
            "source": "./services/template.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "outputMime": "text/html",
            "adapterSource": "./adapter/NunjucksTemplateAdapter.ram.json",
            "store": {
                "infraName": "localStore",
                "adapterConfig": { "basePath": "/templates" },
                "extension": "njk"
            }
        }
    }
}`);

const { testMessage, writeJson, setDomainHandler } = utilsForHost(
  "passwordPolicy",
);

function uniqueEmailPath(prefix: string) {
  return `${prefix}.${crypto.randomUUID().slice(0, 8)}@restspace.local.json`;
}

async function writeUser(emailPath: string, password: string) {
  const email = emailPath.replace(/\.json$/, "");
  const msg = testMessage(`/user/${emailPath}`, "PUT")
    .setDataJson({ email, password, roles: "U" });
  return await handleIncomingRequest(msg);
}

async function createHashedUser(emailPath: string, password = "Valid12!") {
  const email = emailPath.replace(/\.json$/, "");
  const user = new AuthUser({ email, password, roles: "U" });
  await user.hashPassword();
  await writeJson(`/user-bypass/${emailPath}`, user, "failed to write user");
  return user;
}

async function readBypassUser(emailPath: string) {
  const msg = testMessage(`/user-bypass/${emailPath}`, "GET");
  const out = await handleIncomingRequest(msg);
  assert(out.ok, "failed to read user");
  return await out.data!.asJson();
}

async function login(emailPath: string, password: string) {
  const msg = testMessage("/auth/login", "POST")
    .setDataJson({ email: emailPath, password });
  const out = await handleIncomingRequest(msg);
  assert(out.ok, `login failed: ${out.status}`);
  const token = out.getHeader("Set-Cookie")?.replace("rs-auth=", "").split(
    ";",
  )[0];
  assert(token, "expected auth cookie");
  return token;
}

async function createResetToken(emailPath: string) {
  const templateMsg = testMessage("/templates/reset-email", "PUT")
    .setData("{{ returnPageUrl | safe }}", "text/html");
  const templateOut = await handleIncomingRequest(templateMsg);
  assert(templateOut.ok, "failed to write reset template");

  let emailBody = "";
  setDomainHandler("email.com", (msg) => {
    emailBody = msg.data?.asStringSync() || "";
  });

  const resetMsg = testMessage(`/account/reset-password/${emailPath}`, "POST");
  const resetOut = await handleIncomingRequest(resetMsg);
  assert(resetOut.ok, "failed to request reset token");

  const token = /[?&]token=([^&]+)/.exec(emailBody)?.[1];
  assert(token, `missing token in email body: ${emailBody}`);
  return token;
}

Deno.test("password policy: rejects weak user password writes and accepts valid writes", async () => {
  assertEquals(
    (await writeUser(uniqueEmailPath("short.policy"), "Short1!")).status,
    400,
  );
  assertEquals(
    (await writeUser(uniqueEmailPath("numbers.policy"), "NoNumbers!")).status,
    400,
  );
  assertEquals(
    (await writeUser(uniqueEmailPath("symbols.policy"), "Numbers12")).status,
    400,
  );

  const validEmailPath = uniqueEmailPath("valid.policy");
  const validOut = await writeUser(validEmailPath, "Valid12!");
  assert(validOut.ok, "valid password should be accepted");

  const saved = await readBypassUser(validEmailPath);
  assertNotEquals(saved.password, "Valid12!");
});

Deno.test("password policy: zero count requirements disable number and symbol checks", () => {
  const result = validatePasswordStrength("abcdefgh", {
    minLength: 8,
    requiredNumbers: 0,
    requiredSymbols: 0,
  });
  assert(
    result.ok,
    "numbers and symbols should not be required when counts are zero",
  );
});

Deno.test("password policy: masked password update preserves stored hash", async () => {
  const emailPath = uniqueEmailPath("masked.policy");
  const original = await createHashedUser(emailPath);
  const token = await login(emailPath, "Valid12!");

  let msg = testMessage(`/user/${emailPath}`, "GET", token);
  let out = await handleIncomingRequest(msg);
  assert(out.ok, "failed to get masked user");
  const maskedUser = await out.data!.asJson();
  assertEquals(maskedUser.password, AuthUser.passwordMask);

  msg = testMessage(`/user/${emailPath}`, "PUT", token)
    .setDataJson(maskedUser);
  out = await handleIncomingRequest(msg);
  assert(out.ok, "failed to write masked user");

  const saved = await readBypassUser(emailPath);
  assertEquals(saved.password, original.password);
});

Deno.test("password policy: password reset enforces configured policy", async () => {
  const emailPath = uniqueEmailPath("reset.policy");
  await createHashedUser(emailPath);

  let token = await createResetToken(emailPath);
  let msg = testMessage(`/account/token-update-password/${emailPath}`, "POST")
    .setDataJson({ token, password: "NoNums!" });
  let out = await handleIncomingRequest(msg);
  assertEquals(out.status, 400);

  token = await createResetToken(emailPath);
  msg = testMessage(`/account/token-update-password/${emailPath}`, "POST")
    .setDataJson({ token, password: "Reset12!" });
  out = await handleIncomingRequest(msg);
  assert(out.ok, "valid reset password should be accepted");

  const saved = await readBypassUser(emailPath);
  assertNotEquals(saved.password, "Reset12!");
});
