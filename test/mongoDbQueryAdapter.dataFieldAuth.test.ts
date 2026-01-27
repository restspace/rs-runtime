import { assertEquals } from "std/testing/asserts.ts";
import MongoDbQueryAdapter from "../adapter/MongoDbQueryAdapter.ts";

type Captured = {
  pipeline?: unknown[];
  collection?: string;
  aggregateCalls: number;
};

function makeStubAdapterContext(roleSpec: string, userObj: Record<string, unknown> | null) {
  const logger = {
    critical: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
    warning: (..._args: unknown[]) => {},
    info: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    handlers: [],
  };

  return {
    tenant: "test",
    primaryDomain: "example.invalid",
    logger,
    baseLogger: logger as any,
    registerAbortAction: (_msg: unknown, _action: () => void) => {},
    makeRequest: async (msg: unknown) => msg,
    verifyJsonResponse: async (_msg: unknown) => ({}),
    verifyResponse: async (_msg: unknown) => 200,
    runPipeline: async (msg: unknown) => msg,
    getAdapter: async <T>(_url: string, _config: unknown) => ({} as T),
    state: (() => Promise.resolve({})) as any,
    access: { readRoles: roleSpec, writeRoles: "" },
    userObj: userObj ?? undefined,
  };
}

function makeAdapterWithCapture(
  roleSpec: string,
  userObj: Record<string, unknown> | null,
  rows: unknown[],
) {
  const captured: Captured = { aggregateCalls: 0 };
  const context = makeStubAdapterContext(roleSpec, userObj) as any;

  const adapter = new MongoDbQueryAdapter(context, {
    url: "mongodb://example.invalid:27017",
    dbName: "test",
  });

  // Stub out networking: don't connect; provide fake collection.aggregate() capturing the pipeline.
  (adapter as any).ensureConnection = async () => {};
  (adapter as any).db = {
    collection: (name: string) => {
      captured.collection = name;
      return {
        aggregate: (pipeline: unknown[]) => {
          captured.pipeline = pipeline;
          captured.aggregateCalls++;
          return { toArray: async () => rows };
        },
      };
    },
  };

  return { adapter, captured };
}

Deno.test("MongoDbQueryAdapter data-field auth: injects $match at pipeline start", async () => {
  const roleSpec = "U ${organisationId=organisationId}";
  const userObj = { email: "u@test.com", roles: "U", organisationId: "org1" };
  const query = JSON.stringify({
    collection: "users",
    pipeline: [{ $project: { _id: 1, organisationId: 1 } }],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [{ _id: 1 }]);
  const res = await adapter.runQuery(query, {});

  assertEquals(Array.isArray(res), true);
  assertEquals(captured.aggregateCalls, 1);
  assertEquals(Array.isArray(captured.pipeline), true);
  assertEquals((captured.pipeline as any[])[0], { $match: { organisationId: "org1" } });
});

Deno.test("MongoDbQueryAdapter data-field auth: injects $match after $search/$geoNear-style first stages", async () => {
  const roleSpec = "U ${organisationId=organisationId}";
  const userObj = { email: "u@test.com", roles: "U", organisationId: "org1" };
  const query = JSON.stringify({
    collection: "users",
    pipeline: [
      { $search: { index: "idx", text: { query: "x", path: "name" } } },
      { $project: { _id: 1, organisationId: 1 } },
    ],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [{ _id: 1 }]);
  await adapter.runQuery(query, {});

  assertEquals(captured.aggregateCalls, 1);
  const pipeline = captured.pipeline as any[];
  assertEquals(Object.keys(pipeline[0])[0], "$search");
  assertEquals(pipeline[1], { $match: { organisationId: "org1" } });
});

Deno.test("MongoDbQueryAdapter data-field auth: multiple rules become $and match", async () => {
  const roleSpec = "U ${orgId=organisationId} ${dept=department}";
  const userObj = { email: "u@test.com", roles: "U", organisationId: "org1", department: "sales" };
  const query = JSON.stringify({
    collection: "users",
    pipeline: [{ $project: { _id: 1 } }],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [{ _id: 1 }]);
  await adapter.runQuery(query, {});

  const pipeline = captured.pipeline as any[];
  assertEquals(pipeline[0], { $match: { $and: [{ orgId: "org1" }, { dept: "sales" }] } });
});

Deno.test("MongoDbQueryAdapter data-field auth: injected $match occurs before paging $facet", async () => {
  const roleSpec = "U ${organisationId=organisationId}";
  const userObj = { email: "u@test.com", roles: "U", organisationId: "org1" };
  const query = JSON.stringify({
    collection: "users",
    from: 10,
    size: 5,
    pipeline: [{ $project: { _id: 1 } }],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [
    { items: [{ _id: 1 }], total: 123 },
  ]);
  const res = await adapter.runQuery(query, {});

  assertEquals((res as any).total, 123);
  const pipeline = captured.pipeline as any[];
  const matchIdx = pipeline.findIndex((s) => s && typeof s === "object" && "$match" in s);
  const facetIdx = pipeline.findIndex((s) => s && typeof s === "object" && "$facet" in s);
  assertEquals(matchIdx >= 0, true);
  assertEquals(facetIdx >= 0, true);
  assertEquals(matchIdx < facetIdx, true);
});

Deno.test("MongoDbQueryAdapter data-field auth: missing user field fails closed with 404 and does not query Mongo", async () => {
  const roleSpec = "U ${organisationId=organisationId}";
  const userObj = { email: "u@test.com", roles: "U" };
  const query = JSON.stringify({
    collection: "users",
    pipeline: [{ $project: { _id: 1 } }],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [{ _id: 1 }]);
  const res = await adapter.runQuery(query, {});

  assertEquals(res, 404);
  assertEquals(captured.aggregateCalls, 0);
  assertEquals(captured.pipeline, undefined);
});

Deno.test("MongoDbQueryAdapter data-field auth: missing context.userObj fails closed with 404", async () => {
  const roleSpec = "U ${organisationId=organisationId}";
  const query = JSON.stringify({
    collection: "users",
    pipeline: [{ $project: { _id: 1 } }],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, null, [{ _id: 1 }]);
  const res = await adapter.runQuery(query, {});

  assertEquals(res, 404);
  assertEquals(captured.aggregateCalls, 0);
});

Deno.test("MongoDbQueryAdapter data-field auth: unsafe data field name is rejected with 500", async () => {
  const roleSpec = "U ${$where=organisationId}";
  const userObj = { email: "u@test.com", roles: "U", organisationId: "org1" };
  const query = JSON.stringify({
    collection: "users",
    pipeline: [{ $project: { _id: 1 } }],
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [{ _id: 1 }]);
  const res = await adapter.runQuery(query, {});

  assertEquals(res, 500);
  assertEquals(captured.aggregateCalls, 0);
});

Deno.test("MongoDbQueryAdapter data-field auth: when no rules exist, pipeline is not modified", async () => {
  const roleSpec = "U";
  const userObj = { email: "u@test.com", roles: "U", organisationId: "org1" };
  const originalPipeline = [{ $project: { _id: 1 } }];
  const query = JSON.stringify({
    collection: "users",
    pipeline: originalPipeline,
  });

  const { adapter, captured } = makeAdapterWithCapture(roleSpec, userObj, [{ _id: 1 }]);
  await adapter.runQuery(query, {});

  assertEquals(captured.aggregateCalls, 1);
  assertEquals(captured.pipeline, originalPipeline);
});

