import { assertEquals, assertThrows } from "std/testing/asserts.ts";
import { ObjectId } from "mongodb";
import {
  applyAggregatePaging,
  isMongoDuplicateKeyError,
  isMongoTransientError,
  mongoErrorToHttpStatus,
  normalizeCollectionName,
  parseAggregateQuery,
  parseId,
  QueryFormatError,
} from "../adapter/mongoDbCommon.ts";

Deno.test("parseId returns ObjectId for valid 24-hex strings", () => {
  const idStr = "507f1f77bcf86cd799439011";
  const id = parseId(idStr);
  if (!(id instanceof ObjectId)) {
    throw new Error("Expected ObjectId");
  }
  assertEquals(id.toString(), idStr);
});

Deno.test("parseId returns string for non-ObjectId keys", () => {
  const key = "user-abc-123";
  const id = parseId(key);
  assertEquals(id, key);
});

Deno.test("normalizeCollectionName keeps readable chars and replaces others", () => {
  assertEquals(normalizeCollectionName("orders-2025"), "orders-2025");
  assertEquals(normalizeCollectionName("a/b c"), "a_b_c");
});

Deno.test("parseAggregateQuery accepts minimal aggregate JSON", () => {
  const q = parseAggregateQuery({
    collection: "orders",
    pipeline: [{ $match: { status: "paid" } }],
  });
  assertEquals(q.collection, "orders");
  assertEquals(q.pipeline.length, 1);
});

Deno.test("parseAggregateQuery rejects non-object", () => {
  assertThrows(
    () => parseAggregateQuery("not an object"),
    QueryFormatError,
  );
});

Deno.test("applyAggregatePaging appends $skip/$limit by default", () => {
  const pipeline = [{ $match: { a: 1 } }];
  const out = applyAggregatePaging(pipeline, 10, 5);
  assertEquals(out, [{ $match: { a: 1 } }, { $skip: 5 }, { $limit: 10 }]);
});

Deno.test("applyAggregatePaging can be disabled", () => {
  const pipeline = [{ $match: { a: 1 } }];
  const out = applyAggregatePaging(pipeline, 10, 5, "none");
  assertEquals(out, pipeline);
});

Deno.test("isMongoDuplicateKeyError detects code 11000", () => {
  assertEquals(isMongoDuplicateKeyError({ code: 11000 }), true);
  assertEquals(isMongoDuplicateKeyError({ code: 123 }), false);
});

Deno.test("isMongoTransientError detects WriteConflict code and common labels", () => {
  assertEquals(isMongoTransientError({ code: 112 }), true);
  assertEquals(isMongoTransientError({ errorLabels: ["RetryableWriteError"] }), true);
  assertEquals(isMongoTransientError({ hasErrorLabel: (x: string) => x === "TransientTransactionError" }), true);
  assertEquals(isMongoTransientError({}), false);
});

Deno.test("mongoErrorToHttpStatus maps duplicate key to 409 and transient to 503", () => {
  assertEquals(mongoErrorToHttpStatus({ code: 11000 }), 409);
  assertEquals(mongoErrorToHttpStatus({ code: 112 }), 503);
  assertEquals(mongoErrorToHttpStatus({ message: "something else" }), 500);
});
