import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "std/testing/asserts.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { Url } from "rs-core/Url.ts";
import { DirDescriptor } from "rs-core/DirDescriptor.ts";
import { config } from "../config.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { AuthUser } from "../auth/AuthUser.ts";

config.server = testServerConfig;

const tenant = "agentSurface";
const host = `${tenant}.restspace.local:3100`;
const password = "hello";

function pathPattern(pathInfo: DirDescriptor["paths"][number]): string | undefined {
  const spec = pathInfo[2];
  return typeof spec === "object" && spec !== null && "pattern" in spec
    ? spec.pattern
    : undefined;
}

const exposedDatasetSchema = {
  type: "object",
  title: "Account",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string" },
  },
  "x-agent": {
    entityName: "account",
    entityNamePlural: "accounts",
    summaryFields: ["name", "status"],
    searchableFields: ["name"],
    filterableFields: ["status"],
  },
  "x-render": {
    defaultShape: "entity",
  },
  "x-expose": {
    mcp: true,
  },
};

const secretDatasetSchema = {
  type: "object",
  title: "Secret",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
  },
  "x-agent": {
    entityName: "secret",
    entityNamePlural: "secrets",
    summaryFields: ["name"],
    searchableFields: ["name"],
    filterableFields: ["id"],
  },
  "x-render": {
    defaultShape: "entity",
  },
  "x-expose": {
    mcp: true,
  },
};

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
    "/auth": {
      name: "Auth",
      source: "./services/auth.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      userUrlPattern: "/user/${email}",
    },
    "/user": {
      name: "User",
      source: "./services/user-data.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      infraName: "localStore",
      adapterConfig: {
        basePath: "/data/agent-surface/user",
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
        basePath: "/data/agent-surface/user",
      },
      datasetName: "user",
      schema: userSchema,
    },
    "/data": {
      name: "Data",
      source: "./services/data.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      infraName: "localStore",
      adapterConfig: {
        basePath: "/data/agent-surface/data",
      },
    },
    "/accounts": {
      name: "Accounts",
      source: "./services/dataset.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      infraName: "localStore",
      adapterConfig: {
        basePath: "/data/agent-surface/accounts",
      },
      datasetName: "accounts",
      schema: exposedDatasetSchema,
    },
    "/secret": {
      name: "Secret",
      source: "./services/dataset.rsm.json",
      access: { readRoles: "S", writeRoles: "S" },
      infraName: "localStore",
      adapterConfig: {
        basePath: "/data/agent-surface/secret",
      },
      datasetName: "secret",
      schema: secretDatasetSchema,
    },
    "/pipeline": {
      name: "Configured Pipeline",
      source: "./services/pipeline.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      pipeline: [],
      inputSchema: { type: "object" },
      outputSchema: { type: "object", properties: { items: { type: "array" } } },
      "x-agent": {
        kind: "query",
        title: "Configured read",
        description: "Read through a configured pipeline.",
        resultShape: "entity_list",
        suggestedUtterances: ["configured read"],
      },
      "x-policy": {
        effect: "read",
      },
      "x-expose": {
        mcp: true,
      },
    },
    "/pipes": {
      name: "Pipeline Store",
      source: "./services/pipeline-store.rsm.json",
      access: { readRoles: "all", writeRoles: "all" },
      store: {
        infraName: "localStore",
        adapterConfig: {
          basePath: "/data/agent-surface/pipes",
        },
      },
    },
  },
} as any;

function testMessage(url: string, method: MessageMethod, token?: string) {
  const msgUrl = new Url(url);
  msgUrl.scheme = "http://";
  msgUrl.domain = host;
  const msg = new Message(msgUrl, tenant, method, null)
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

async function putJson(url: string, value: unknown, manage = false) {
  const response = await sendRequest(url, "PUT", { body: value, manage });
  assert(response.ok, `PUT ${url} failed: ${response.status} ${response.data?.asStringSync() || ""}`);
}

async function getJson(url: string, token?: string) {
  const response = await sendRequest(url, "GET", { token });
  assert(response.ok, `GET ${url} failed: ${response.status} ${response.data?.asStringSync() || ""}`);
  return await response.data!.asJson();
}

async function logIn(emailPath: string) {
  const response = await sendRequest("/auth/login", "POST", {
    body: { email: emailPath, password },
  });
  assert(response.ok, `login failed: ${response.status}`);
  let token = response.getHeader("Set-Cookie")?.replace("rs-auth=", "");
  if (token) return token.split(";")[0];
  const body = await response.data?.asJson();
  token = typeof body?._jwt === "string" ? body._jwt : "";
  assert(token, "no auth token in response");
  return token;
}

async function tokenWithRoles(localPart: string, roles: string) {
  const email = `${localPart}@example.com`;
  const user = new AuthUser({ email, password, roles });
  await user.hashPassword();
  await putJson(`/user-bypass/${email}.json`, user);
  return await logIn(`${email}.json`);
}

async function seedAgentSurfaceData() {
  await putJson("/data/contact/.schema.json", {
    "$id": "app://schemas/contact",
    type: "object",
    title: "Contact",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      company: { type: "string" },
    },
    "x-agent": {
      entityName: "contact",
      entityNamePlural: "contacts",
      summaryFields: ["name", "email"],
      searchableFields: ["name", "email", "company"],
      filterableFields: ["company"],
    },
    "x-render": {
      defaultShape: "entity",
    },
    "x-expose": {
      mcp: true,
    },
  });

  await putJson("/data/hidden/.schema.json", {
    type: "object",
    title: "Hidden",
    properties: {
      name: { type: "string" },
    },
  });

  await putJson("/data/bad/.schema.json", {
    type: "object",
    title: "Bad",
    properties: {
      name: { type: "string" },
    },
    "x-agent": {
      entityName: "bad",
      summaryFields: ["missing"],
      searchableFields: ["name"],
      filterableFields: ["name"],
    },
    "x-render": {
      defaultShape: "entity",
    },
    "x-expose": {
      mcp: true,
    },
  });

  await putJson("/pipes/stored-read", {
    pipeline: [],
    inputSchema: { type: "object" },
    outputSchema: { type: "object", properties: { items: { type: "array" } } },
    "x-agent": {
      kind: "query",
      title: "Stored read",
      description: "Read through a stored pipeline.",
      resultShape: "entity_list",
      suggestedUtterances: ["stored read"],
    },
    "x-policy": {
      effect: "read",
    },
    "x-expose": {
      mcp: true,
    },
  }, true);

  await putJson("/pipes/warning-read", {
    pipeline: [],
    "x-agent": {
      kind: "query",
      title: "Warning read",
    },
    "x-policy": {
      effect: "read",
    },
    "x-expose": {
      mcp: true,
    },
  }, true);

  await putJson("/pipes/mutating", {
    pipeline: [],
    "x-agent": {
      kind: "action",
      title: "Mutating",
      description: "Should not be exposed as read-only.",
      resultShape: "entity",
      suggestedUtterances: ["mutate"],
    },
    "x-policy": {
      effect: "bulk_mutation",
    },
    "x-expose": {
      mcp: true,
    },
  }, true);

  await putJson("/pipes/legacy-array", [], true);
}

Deno.test("agent-surface discovers valid exposed entities and hides invalid or unexposed entities", async () => {
  await seedAgentSurfaceData();

  const rootDirectory = await getJson("/.well-known/restspace/agent-surface/?$list=details") as DirDescriptor;
  assert(rootDirectory.paths.some((pathInfo) => pathInfo[0] === "entities/" && pathPattern(pathInfo) === "store-view"));
  assert(rootDirectory.paths.some((pathInfo) => pathInfo[0] === "pipelines/" && pathPattern(pathInfo) === "store-view"));
  assert(rootDirectory.paths.some((pathInfo) => pathInfo[0] === "validate" && pathPattern(pathInfo) === "view"));

  const directory = await getJson("/.well-known/restspace/agent-surface/entities/?$list=details") as DirDescriptor;
  assertStrictEquals(directory.spec?.pattern, "store-view");
  const result = await Promise.all(directory.paths.map(async ([id]) =>
    await getJson(`/.well-known/restspace/agent-surface/entities/${id}`) as { title?: string; entityName?: string; id: string }
  ));

  const names = result.map((item) => item.entityName || item.title).sort();
  assertEquals(names, ["account", "contact"]);

  const contact = result.find((item) => item.entityName === "contact");
  assert(contact, "expected contact entity in compact discovery");
  const detail = await getJson(`/.well-known/restspace/agent-surface/entities/${contact.id}`) as {
    schema: { title?: string };
  };
  assertStrictEquals(detail.schema.title, "Contact");
});

Deno.test("agent-surface discovers only valid read-only exposed pipelines", async () => {
  await seedAgentSurfaceData();

  const directory = await getJson("/.well-known/restspace/agent-surface/pipelines/?$list=details") as DirDescriptor;
  assertStrictEquals(directory.spec?.pattern, "store-view");
  const result = await Promise.all(directory.paths.map(async ([id]) =>
    await getJson(`/.well-known/restspace/agent-surface/pipelines/${id}`) as { title?: string; effect?: string; warnings: number }
  ));

  const titles = result.map((item) => item.title).sort();
  assertEquals(titles, ["Configured read", "Stored read", "Warning read"]);
  assert(result.every((item) => item.effect === "read"), "all discovered pipelines should be read-only");
  assert(result.some((item) => item.title === "Warning read" && item.warnings > 0), "warning-only pipeline should remain discoverable");
});

Deno.test("agent-surface validate reports excluded invalid metadata and warning-only metadata", async () => {
  await seedAgentSurfaceData();

  const validation = await getJson("/.well-known/restspace/agent-surface/validate") as {
    summary: {
      entities: { errors: number; warnings: number; excluded: number };
      pipelines: { errors: number; warnings: number; excluded: number };
    };
    entities: { issues: Array<{ code: string; severity: string; sourcePath: string }> };
    pipelines: { issues: Array<{ code: string; severity: string; sourcePath: string }> };
  };

  assert(validation.summary.entities.errors > 0, "invalid entity should produce validation errors");
  assert(validation.summary.entities.excluded > 0, "invalid entity should be counted as excluded");
  assert(validation.entities.issues.some((issue) =>
    issue.code === "metadata_field_not_found" && issue.sourcePath.includes("/data/bad/.schema.json")
  ));
  assert(validation.summary.pipelines.errors > 0, "mutating pipeline should produce validation errors");
  assert(validation.pipelines.issues.some((issue) =>
    issue.code === "pipeline_effect_not_read" && issue.sourcePath.includes("/pipes/mutating")
  ));
  assert(validation.summary.pipelines.warnings > 0, "warning-only pipeline should produce validation warnings");
  assert(validation.pipelines.issues.some((issue) =>
    issue.severity === "warning" && issue.sourcePath.includes("/pipes/warning-read")
  ));
});

Deno.test("agent-surface filters metadata by owning service read access", async () => {
  await seedAgentSurfaceData();

  const anonDirectory = await getJson("/.well-known/restspace/agent-surface/entities/?$list=details") as DirDescriptor;
  const anonResult = await Promise.all(anonDirectory.paths.map(async ([id]) =>
    await getJson(`/.well-known/restspace/agent-surface/entities/${id}`) as { entityName?: string }
  ));
  assert(!anonResult.some((item) => item.entityName === "secret"), "anonymous users should not see restricted entity metadata");

  const token = await tokenWithRoles("surface-reader", "S");
  const authedDirectory = await getJson("/.well-known/restspace/agent-surface/entities/?$list=details", token) as DirDescriptor;
  const authedResult = await Promise.all(authedDirectory.paths.map(async ([id]) =>
    await getJson(`/.well-known/restspace/agent-surface/entities/${id}`, token) as { entityName?: string }
  ));
  assert(authedResult.some((item) => item.entityName === "secret"), "authorized users should see restricted entity metadata");
});
