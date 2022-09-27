import { assertEquals } from "std/testing/asserts.ts";
import { schemaToMapping } from "../adapter/ElasticDataAdapter.ts";

Deno.test('schema to mapping primitives', function () {
    const schema = {
        type: "object",
        properties: {
            a: { type: "string" },
            b: { type: "number" },
            c: { type: "string", format: "date-time" }
        }
    };
    const mapping = schemaToMapping(schema);
    assertEquals(mapping, {
        properties: {
            a: { type: "keyword" },
            b: { type: "double" },
            c: { type: "date" }
        }
    });
});

Deno.test('schema to mapping subobject', function () {
    const schema = {
        type: "object",
        properties: {
            a: { type: "string" },
            b: { type: "number" },
            c: {
                type: "object",
                properties: {
                    d: { type: "boolean" }
                }
            }
        }
    };
    const mapping = schemaToMapping(schema);
    assertEquals(mapping, {
        properties: {
            a: { type: "keyword" },
            b: { type: "double" },
            c: { 
                properties: {
                    d: { type: "boolean" }
                }
            }
        }
    });
});

Deno.test('schema to mapping simple array', function () {
    const schema = {
        type: "object",
        properties: {
            a: { type: "string" },
            b: { type: "number" },
            c: {
                type: "array",
                items: {
                    type: "string",
                    search: "textual"
                }
            }
        }
    };
    const mapping = schemaToMapping(schema);
    assertEquals(mapping, {
        properties: {
            a: { type: "keyword" },
            b: { type: "double" },
            c: { type: "text" }
        }
    });
});

Deno.test('schema to mapping object array to nested', function () {
    const schema = {
        type: "object",
        properties: {
            a: { type: "string" },
            b: { type: "number" },
            c: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        d: { type: "string" },
                        e: { type: "number" }
                    }
                }
            }
        }
    };
    const mapping = schemaToMapping(schema);
    assertEquals(mapping, {
        properties: {
            a: { type: "keyword" },
            b: { type: "double" },
            c: {
                type: "nested",
                properties: {
                    d: { type: "keyword" },
                    e: { type: "double" }
                }
            }
        }
    });
});
