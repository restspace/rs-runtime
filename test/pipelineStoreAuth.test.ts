import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "std/testing/asserts.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { mockHandler } from "../services/mock.ts";

config.server = testServerConfig;

const tenant = "pipelineStoreAuth";
const host = `${tenant}.restspace.local:3100`;
const password = "hello";

const userSchema = {
  type: "object",
  properties: {
    token: { type: "string" },
    tokenExpiry: { type: "string", format: "date-time" },
    email: { type: "string", format: "email" },
    roles: { type: "string" },
    password: { type: "password" },
  },
  required: ["email"],
  pathPattern: "${email}",
};

testServicesConfig[tenant] = {
  authServicePath: "/auth",
  services: {
    "/": {
      name: "Mock",
      source: "./services/mock.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
    },
    "/auth": {
      name: "Auth",
      source: "./services/auth.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      userUrlPattern: "/user/${email}",
    },
    "/lib": {
      name: "Lib",
      source: "./services/lib.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
    },
    "/user": {
      name: "User",
      source: "./services/user-data.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      infraName: "localStore",
      adapterConfig: {
        basePath: "/data/pipeline-store-auth/user",
      },
      datasetName: "user",
      schema: userSchema,
    },
    "/user-bypass": {
      name: "User bypass",
      source: "./services/dataset.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      infraName: "localStore",
      adapterConfig: {
        basePath: "/data/pipeline-store-auth/user",
      },
      datasetName: "user",
      schema: userSchema,
    },
    "/pipes": {
      name: "Pipeline store",
      source: "./services/pipeline-store.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      store: {
        infraName: "localStore",
        adapterConfig: {
          basePath: "/data/pipeline-store-auth/pipes",
        },
      },
    },
    "/secure-pipes": {
      name: "Secure pipeline store",
      source: "./services/pipeline-store.rsm.json",
      access: { readRoles: "S", writeRoles: "S" },
      store: {
        infraName: "localStore",
        adapterConfig: {
          basePath: "/data/pipeline-store-auth/secure-pipes",
        },
      },
    },
  },
};

const tokenCache = new Map<string, Promise<string>>();

function testMessage(url: string, method: MessageMethod, token?: string) {
  const msg = new Message(url, tenant, method, null)
    .setHeader("host", host);
  if (token) msg.cookies["rs-auth"] = token;
  return msg;
}

async function sendRequest(
  url: string,
  method: MessageMethod,
  opts: { body?: unknown; token?: string; manage?: boolean } = {},
) {
  const msg = testMessage(url, method, opts.token);
  if (opts.manage) msg.setHeader("X-Restspace-Request-Mode", "manage");
  if (opts.body !== undefined) msg.setDataJson(opts.body);
  return await handleIncomingRequest(msg);
}

async function managePut(url: string, value: unknown, token?: string) {
  const msgOut = await sendRequest(url, "PUT", {
    body: value,
    token,
    manage: true,
  });
  assert(msgOut.ok, `failed manage PUT ${url}: ${msgOut.status}`);
  return msgOut;
}

async function manageGetJson(url: string, token?: string) {
  const msgOut = await sendRequest(url, "GET", { token, manage: true });
  assert(msgOut.ok, `failed manage GET ${url}: ${msgOut.status}`);
  return await msgOut.data?.asJson();
}

async function logIn(emailPath: string) {
  const msgOut = await sendRequest("/auth/login", "POST", {
    body: { email: emailPath, password },
  });
  assert(msgOut.ok, `failed to log in ${emailPath}: ${msgOut.status}`);
  let token = msgOut.getHeader("Set-Cookie")?.replace("rs-auth=", "");
  if (token) {
    return token.split(";")[0];
  }
  const body = await msgOut.data?.asJson();
  token = typeof body?._jwt === "string" ? body._jwt : "";
  assert(token, `no auth token in cookie or body for ${emailPath}`);
  return token;
}

async function getLoggedInUserToken(localPart: string, roles: string) {
  const cacheKey = `${localPart}:${roles}`;
  if (!tokenCache.has(cacheKey)) {
    tokenCache.set(
      cacheKey,
      (async () => {
        const email = `${localPart}@example.com`;
        const user = new AuthUser({
          email,
          password,
          roles,
        });
        await user.hashPassword();
        await sendRequest(`/user-bypass/${email}.json`, "PUT", { body: user });
        return await logIn(`${email}.json`);
      })(),
    );
  }
  return await tokenCache.get(cacheKey)!;
}

Deno.test("pipeline-store keeps legacy array specs working", async () => {
  mockHandler.getString("/test/legacy-array", "legacy array ok");
  await managePut("/pipes/legacy-array", ["GET /test/legacy-array"]);

  const msgOut = await sendRequest("/pipes/legacy-array", "GET");
  assertStrictEquals(msgOut.status, 200);
  assertStrictEquals(await msgOut.data?.asString(), "legacy array ok");
});

Deno.test("pipeline-store applies getRoles and blocks execution before the pipeline runs", async () => {
  let runCount = 0;
  mockHandler.subhandlers["/test/get-roles"] = (msg: Message) => {
    runCount++;
    return Promise.resolve(msg.setData("get roles ok", "text/plain"));
  };

  await managePut("/pipes/get-roles", {
    getRoles: "GR",
    pipeline: ["GET /test/get-roles"],
  });

  const denied = await sendRequest("/pipes/get-roles", "GET");
  assertStrictEquals(denied.status, 401);
  assertStrictEquals(runCount, 0);

  const readerToken = await getLoggedInUserToken("get-reader", "GR");
  const allowed = await sendRequest("/pipes/get-roles", "GET", {
    token: readerToken,
  });
  assertStrictEquals(allowed.status, 200);
  assertStrictEquals(await allowed.data?.asString(), "get roles ok");
  assertStrictEquals(runCount, 1);

  await managePut("/pipes/get-missing", {
    pipeline: ["GET /test/get-roles"],
  });
  const missing = await sendRequest("/pipes/get-missing", "GET");
  assertStrictEquals(missing.status, 401);
  assertStrictEquals(runCount, 1);
});

Deno.test("pipeline-store applies postRoles and fails closed when postRoles is missing", async () => {
  mockHandler.getString("/test/post-roles", "post roles ok");

  await managePut("/pipes/post-roles", {
    postRoles: "PR",
    pipeline: ["GET /test/post-roles"],
  });

  const denied = await sendRequest("/pipes/post-roles", "POST", {
    body: { value: 1 },
  });
  assertStrictEquals(denied.status, 401);

  const posterToken = await getLoggedInUserToken("post-user", "PR");
  const allowed = await sendRequest("/pipes/post-roles", "POST", {
    body: { value: 1 },
    token: posterToken,
  });
  assertStrictEquals(allowed.status, 200);
  assertStrictEquals(await allowed.data?.asString(), "post roles ok");

  await managePut("/pipes/post-missing", {
    getRoles: "all",
    pipeline: ["GET /test/post-roles"],
  });
  const missing = await sendRequest("/pipes/post-missing", "POST", {
    body: { value: 1 },
  });
  assertStrictEquals(missing.status, 401);
});

Deno.test("pipeline-store applies writeRoles to PUT, PATCH and DELETE and fails closed when missing", async () => {
  mockHandler.getString("/test/write-roles", "write roles ok");

  await managePut("/pipes/write-roles", {
    writeRoles: "WR",
    pipeline: ["GET /test/write-roles"],
  });

  const writerToken = await getLoggedInUserToken("write-user", "WR");

  for (const method of ["PUT", "PATCH", "DELETE"] as MessageMethod[]) {
    const msgOut = await sendRequest("/pipes/write-roles", method, {
      body: method === "DELETE" ? undefined : { value: method },
      token: writerToken,
    });
    assertStrictEquals(msgOut.status, 200, `expected ${method} to be allowed`);
    assertStrictEquals(await msgOut.data?.asString(), "write roles ok");
  }

  await managePut("/pipes/write-missing", {
    getRoles: "all",
    pipeline: ["GET /test/write-roles"],
  });

  for (const method of ["PUT", "PATCH", "DELETE"] as MessageMethod[]) {
    const msgOut = await sendRequest("/pipes/write-missing", method, {
      body: method === "DELETE" ? undefined : { value: method },
    });
    assertStrictEquals(
      msgOut.status,
      401,
      `expected ${method} to fail without writeRoles`,
    );
  }
});

Deno.test("pipeline-store requires both service access and wrapped method roles", async () => {
  mockHandler.getString("/test/secure-roles", "secure roles ok");

  const secureAdminToken = await getLoggedInUserToken("secure-admin", "S GR");
  await managePut("/secure-pipes/combined-auth", {
    getRoles: "GR",
    pipeline: ["GET /test/secure-roles"],
  }, secureAdminToken);

  const wrapperOnlyToken = await getLoggedInUserToken("wrapper-only", "GR");
  const serviceDenied = await sendRequest(
    "/secure-pipes/combined-auth",
    "GET",
    {
      token: wrapperOnlyToken,
    },
  );
  assertStrictEquals(serviceDenied.status, 401);

  const serviceOnlyToken = await getLoggedInUserToken("service-only", "S");
  const wrapperDenied = await sendRequest(
    "/secure-pipes/combined-auth",
    "GET",
    {
      token: serviceOnlyToken,
    },
  );
  assertStrictEquals(wrapperDenied.status, 401);

  const allowed = await sendRequest("/secure-pipes/combined-auth", "GET", {
    token: secureAdminToken,
  });
  assertStrictEquals(allowed.status, 200);
  assertStrictEquals(await allowed.data?.asString(), "secure roles ok");
});

Deno.test("manage mode continues to administer wrapped specs without triggering wrapped runtime auth", async () => {
  const spec = {
    pipeline: ["GET /test/manage-mode"],
  };
  await managePut("/pipes/manage-mode", spec);

  const stored = await manageGetJson("/pipes/manage-mode");
  assertEquals(stored, spec);

  const runtime = await sendRequest("/pipes/manage-mode", "GET");
  assertStrictEquals(runtime.status, 401);
});

Deno.test("pipeline-store returns 400 for malformed wrapped specs", async () => {
  await managePut("/pipes/invalid-wrapper", {
    getRoles: 123,
    pipeline: ["GET /test/invalid-wrapper"],
  });

  const msgOut = await sendRequest("/pipes/invalid-wrapper", "GET");
  assertStrictEquals(msgOut.status, 400);
});

Deno.test("wrapped specs still support $to-step", async () => {
  mockHandler.getString("/test/to-step-1", "step one");
  mockHandler.getString("/test/to-step-2", "step two");

  await managePut("/pipes/to-step", {
    getRoles: "all",
    pipeline: [
      "GET /test/to-step-1",
      "GET /test/to-step-2",
    ],
  });

  const msgOut = await sendRequest("/pipes/to-step?$to-step=0", "GET");
  assertStrictEquals(msgOut.status, 200);
  assertStrictEquals(await msgOut.data?.asString(), "step one");
});
