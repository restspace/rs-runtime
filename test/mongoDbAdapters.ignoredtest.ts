import { assertEquals, assert } from "std/testing/asserts.ts";
import { MessageBody } from "rs-core/MessageBody.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";
import MongoDbDataAdapter from "../adapter/MongoDbDataAdapter.ts";
import MongoDbQueryAdapter from "../adapter/MongoDbQueryAdapter.ts";
import { cleanIgnoreMarkers } from "../adapter/mongoDbCommon.ts";
import { makeAdapterContext } from "./testUtility.ts";

const MONGO_URL = "mongodb://localhost:27017";
const TEST_DB = "rs_adapter_test";

const dataAdapterProps = {
  url: MONGO_URL,
  dbName: TEST_DB,
};

const queryAdapterProps = {
  url: MONGO_URL,
  dbName: TEST_DB,
};

// --- MongoDbDataAdapter tests ---

Deno.test("MongoDbDataAdapter: writes and reads a key", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const body = MessageBody.fromObject({ name: "Alice", age: 30 });
    const writeResult = await adapter.writeKey("testcoll", "user1", body);
    assert(writeResult === 200 || writeResult === 201, `Expected 200 or 201, got ${writeResult}`);

    const readResult = await adapter.readKey("testcoll", "user1");
    assert(typeof readResult === "object", "Expected object result");
    assertEquals((readResult as Record<string, unknown>).name, "Alice");
    assertEquals((readResult as Record<string, unknown>).age, 30);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: returns 404 for missing key", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const result = await adapter.readKey("testcoll", "nonexistent-key-xyz");
    assertEquals(result, 404);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: deletes a key", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const body = MessageBody.fromObject({ temp: true });
    await adapter.writeKey("testcoll", "todelete", body);

    const deleteResult = await adapter.deleteKey("testcoll", "todelete");
    assertEquals(deleteResult, 200);

    const readResult = await adapter.readKey("testcoll", "todelete");
    assertEquals(readResult, 404);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: delete returns 404 for missing key", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const result = await adapter.deleteKey("testcoll", "never-existed-xyz");
    assertEquals(result, 404);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: lists datasets (collections)", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    // Ensure at least one document exists
    const body = MessageBody.fromObject({ x: 1 });
    await adapter.writeKey("listtest", "item1", body);

    const result = await adapter.listDataset("", 1000, 0);
    assert(Array.isArray(result), "Expected array");
    const names = (result as PathInfo[]).map(([name]) => name);
    assert(names.some((n) => n === "listtest/"), "Expected listtest/ in collection list");
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: lists keys in dataset", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const body1 = MessageBody.fromObject({ val: 1 });
    const body2 = MessageBody.fromObject({ val: 2 });
    await adapter.writeKey("keylistcoll", "keyA", body1);
    await adapter.writeKey("keylistcoll", "keyB", body2);

    const result = await adapter.listDataset("keylistcoll", 1000, 0);
    assert(Array.isArray(result), "Expected array");
    const keys = (result as PathInfo[]).map(([k]) => k);
    assert(keys.includes("keyA"), "Expected keyA");
    assert(keys.includes("keyB"), "Expected keyB");
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: checkKey returns metadata for existing key", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const body = MessageBody.fromObject({ check: true });
    await adapter.writeKey("checkcoll", "checkkey", body);

    const meta = await adapter.checkKey("checkcoll", "checkkey");
    assertEquals(meta.status, "file");
    if (meta.status === "file") {
      assert(meta.dateModified instanceof Date, "Expected dateModified");
    }
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: checkKey returns none for missing key", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const meta = await adapter.checkKey("checkcoll", "missing-check-key");
    assertEquals(meta.status, "none");
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: writes and reads schema", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    };
    const writeResult = await adapter.writeSchema("schemacoll", schema);
    assert(writeResult === 200 || writeResult === 201, `Expected 200 or 201, got ${writeResult}`);

    const readResult = await adapter.readSchema("schemacoll");
    assert(typeof readResult === "object", "Expected object");
    assertEquals((readResult as Record<string, unknown>).type, "object");
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: readSchema returns 404 for missing schema", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const result = await adapter.readSchema("no-schema-here-xyz");
    assertEquals(result, 404);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: checkSchema returns metadata for existing schema", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const schema = { type: "string" };
    await adapter.writeSchema("checkschema", schema);

    const meta = await adapter.checkSchema("checkschema");
    assertEquals(meta.status, "file");
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: checkSchema returns none for missing schema", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const meta = await adapter.checkSchema("nonexistent-schema-xyz");
    assertEquals(meta.status, "none");
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: writeKey without key generates ID", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const body = MessageBody.fromObject({ auto: true });
    const result = await adapter.writeKey("autocoll", undefined, body);
    // Should return the generated ID as a string or 201
    assert(typeof result === "string" || result === 201, `Expected string ID or 201, got ${result}`);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: deleteDataset drops collection", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const body = MessageBody.fromObject({ drop: true });
    await adapter.writeKey("todrop", "item", body);

    const deleteResult = await adapter.deleteDataset("todrop");
    assertEquals(deleteResult, 200);

    const listResult = await adapter.listDataset("todrop", 1000, 0);
    assert(Array.isArray(listResult), "Expected array");
    assertEquals((listResult as PathInfo[]).length, 0);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: deleteDataset returns 404 for missing collection", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const result = await adapter.deleteDataset("never-existed-collection-xyz");
    assertEquals(result, 404);
  } finally {
    await adapter.close();
  }
});

Deno.test("MongoDbDataAdapter: instanceContentType returns schema URL", async () => {
  const adapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    const ct = await adapter.instanceContentType("mycoll", "/data");
    assert(ct.includes("application/json"), "Expected application/json");
    assert(ct.includes(".schema.json"), "Expected schema URL");
  } finally {
    await adapter.close();
  }
});

// --- MongoDbQueryAdapter tests ---

Deno.test("MongoDbQueryAdapter: runs simple aggregate query", async () => {
  // First, ensure some data exists
  const dataAdapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    await dataAdapter.writeKey("querycoll", "q1", MessageBody.fromObject({ status: "active", value: 10 }));
    await dataAdapter.writeKey("querycoll", "q2", MessageBody.fromObject({ status: "active", value: 20 }));
    await dataAdapter.writeKey("querycoll", "q3", MessageBody.fromObject({ status: "inactive", value: 5 }));
  } finally {
    await dataAdapter.close();
  }

  const queryAdapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  try {
    const query = JSON.stringify({
      collection: "querycoll",
      pipeline: [{ $match: { status: "active" } }],
    });

    const result = await queryAdapter.runQuery(query, {}, 1000, 0);
    assert(Array.isArray(result), "Expected array result");
    assertEquals((result as Record<string, unknown>[]).length, 2);
  } finally {
    await queryAdapter.close();
    // Clean up
    const dataAdapter2 = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
    await dataAdapter2.deleteDataset("querycoll");
    await dataAdapter2.close();
  }
});

Deno.test("MongoDbQueryAdapter: returns 400 for invalid JSON", async () => {
  const queryAdapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  try {
    const result = await queryAdapter.runQuery("not valid json {{{", {}, 1000, 0);
    assertEquals(result, 400);
  } finally {
    await queryAdapter.close();
  }
});

Deno.test("MongoDbQueryAdapter: returns 400 for invalid query format", async () => {
  const queryAdapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  try {
    // Missing pipeline
    const result = await queryAdapter.runQuery(JSON.stringify({ collection: "test" }), {}, 1000, 0);
    assertEquals(result, 400);
  } finally {
    await queryAdapter.close();
  }
});

Deno.test("MongoDbQueryAdapter: applies paging with from/size", async () => {
  // Set up test data
  const dataAdapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    for (let i = 0; i < 10; i++) {
      await dataAdapter.writeKey("pagecoll", `item${i}`, MessageBody.fromObject({ index: i }));
    }
  } finally {
    await dataAdapter.close();
  }

  const queryAdapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  try {
    const query = JSON.stringify({
      collection: "pagecoll",
      pipeline: [{ $sort: { index: 1 } }],
      from: 2,
      size: 3,
    });

    const result = await queryAdapter.runQuery(query, {});
    assert(result && typeof result === "object" && !Array.isArray(result), "Expected object result");
    const { items, total } = result as { items: Record<string, unknown>[]; total: number };
    assert(Array.isArray(items), "Expected items array");
    assertEquals(items.length, 3);
    assertEquals(total, 10);
  } finally {
    await queryAdapter.close();
    // Clean up
    const dataAdapter2 = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
    await dataAdapter2.deleteDataset("pagecoll");
    await dataAdapter2.close();
  }
});

Deno.test("MongoDbQueryAdapter: does not page without from/size", async () => {
  // Set up test data
  const dataAdapter = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
  try {
    for (let i = 0; i < 5; i++) {
      await dataAdapter.writeKey("nopage", `item${i}`, MessageBody.fromObject({ idx: i }));
    }
  } finally {
    await dataAdapter.close();
  }

  const queryAdapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  try {
    const query = JSON.stringify({
      collection: "nopage",
      pipeline: [{ $match: {} }],
    });

    // Even with take=2, skip=0, no from/size should return all
    const result = await queryAdapter.runQuery(query, {}, 2, 0);
    assert(Array.isArray(result), "Expected array result");
    assertEquals((result as Record<string, unknown>[]).length, 5);
  } finally {
    await queryAdapter.close();
    // Clean up
    const dataAdapter2 = new MongoDbDataAdapter(makeAdapterContext("test"), dataAdapterProps);
    await dataAdapter2.deleteDataset("nopage");
    await dataAdapter2.close();
  }
});

Deno.test("MongoDbQueryAdapter: quote returns valid JSON strings", () => {
  const queryAdapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);

  assertEquals(queryAdapter.quote("hello"), '"hello"');
  assertEquals(queryAdapter.quote('say "hi"'), '"say \\"hi\\""');
  assertEquals(queryAdapter.quote(123), "123");
  assertEquals(queryAdapter.quote(true), "true");
  assertEquals(queryAdapter.quote(["a", "b"]), '["a","b"]');

  const objResult = queryAdapter.quote({ nested: true });
  assert(objResult instanceof Error, "Expected Error for object input");
});

// --- $ignore marker tests ---

Deno.test("MongoDbQueryAdapter: quote returns $ignore for empty string when enabled", () => {
  const adapter = new MongoDbQueryAdapter(makeAdapterContext("test"), {
    ...queryAdapterProps,
    ignoreEmptyVariables: true,
  });
  assertEquals(adapter.quote(""), '{ "$ignore": true }');
  assertEquals(adapter.quote("hello"), '"hello"');
});

Deno.test("MongoDbQueryAdapter: quote returns quoted empty string when disabled", () => {
  const adapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  assertEquals(adapter.quote(""), '""');
});

Deno.test("MongoDbQueryAdapter: quote filters empty strings from arrays when enabled", () => {
  const adapter = new MongoDbQueryAdapter(makeAdapterContext("test"), {
    ...queryAdapterProps,
    ignoreEmptyVariables: true,
  });
  assertEquals(adapter.quote(["a", "", "b"]), '["a","b"]');
  assertEquals(adapter.quote(["a", "b"]), '["a","b"]');
});

Deno.test("MongoDbQueryAdapter: quote returns $ignore for array of only empty strings", () => {
  const adapter = new MongoDbQueryAdapter(makeAdapterContext("test"), {
    ...queryAdapterProps,
    ignoreEmptyVariables: true,
  });
  assertEquals(adapter.quote([""]), '{ "$ignore": true }');
  assertEquals(adapter.quote(["", ""]), '{ "$ignore": true }');
});

Deno.test("MongoDbQueryAdapter: quote keeps empty strings in arrays when disabled", () => {
  const adapter = new MongoDbQueryAdapter(makeAdapterContext("test"), queryAdapterProps);
  assertEquals(adapter.quote(["a", "", "b"]), '["a","","b"]');
});

Deno.test("cleanIgnoreMarkers: removes field with $ignore marker", () => {
  const pipeline = [{ $match: { status: "active", category: { $ignore: true } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: { status: "active" } }]);
});

Deno.test("cleanIgnoreMarkers: removes empty $or array", () => {
  const pipeline = [{ $match: { $or: [{ a: { $ignore: true } }, { b: { $ignore: true } }] } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: {} }]);
});

Deno.test("cleanIgnoreMarkers: removes empty $and from parent", () => {
  const pipeline = [{
    $match: {
      $and: [
        { $or: [{ x: { $ignore: true } }] },
        { y: "kept" },
      ],
    },
  }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: { $and: [{ y: "kept" }] } }]);
});

Deno.test("cleanIgnoreMarkers: handles nested $lookup pipeline", () => {
  const pipeline = [{
    $lookup: {
      from: "other",
      pipeline: [{ $match: { status: { $ignore: true } } }],
      as: "joined",
    },
  }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{
    $lookup: {
      from: "other",
      pipeline: [{ $match: {} }],
      as: "joined",
    },
  }]);
});

Deno.test("cleanIgnoreMarkers: leaves non-ignore objects unchanged", () => {
  const pipeline = [{ $match: { a: 1, b: { $gt: 5 } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: { a: 1, b: { $gt: 5 } } }]);
});

Deno.test("cleanIgnoreMarkers: filters $ignore from $in array", () => {
  const pipeline = [{ $match: { tags: { $in: ["a", { $ignore: true }, "b"] } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: { tags: { $in: ["a", "b"] } } }]);
});

Deno.test("cleanIgnoreMarkers: removes empty $in array and parent field", () => {
  const pipeline = [{ $match: { tags: { $in: [{ $ignore: true }] } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: {} }]);
});

Deno.test("cleanIgnoreMarkers: removes empty $all array and parent field", () => {
  const pipeline = [{ $match: { tags: { $all: [{ $ignore: true }] } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: {} }]);
});

Deno.test("cleanIgnoreMarkers: removes $in with $ignore value", () => {
  const pipeline = [{ $match: { tags: { $in: { $ignore: true } } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: {} }]);
});

Deno.test("cleanIgnoreMarkers: removes orphaned $options when $regex is ignored", () => {
  const pipeline = [{ $match: { code: { $regex: { $ignore: true }, $options: "i" } } }];
  const result = cleanIgnoreMarkers(pipeline);
  assertEquals(result, [{ $match: {} }]);
});

// --- Cleanup test database ---

Deno.test("Cleanup: drop test database collections", async () => {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(TEST_DB);
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).drop();
    }
  } finally {
    await client.close();
  }
});
