import { assertEquals } from "std/testing/asserts.ts";
import ElasticDataAdapter, { schemaToMapping } from "../adapter/ElasticDataAdapter.ts";
import ElasticQueryAdapter from "../adapter/ElasticQueryAdapter.ts";
import { makeAdapterContext } from "./testUtility.ts";

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

Deno.test("ElasticDataAdapter tenantIndexes controls physical and logical index names", () => {
    const baseProps = {
        host: "http://elastic",
        username: "user",
        password: "pass",
    };

    const defaultAdapter = new ElasticDataAdapter(
        makeAdapterContext("Tenant A"),
        baseProps,
    );
    const enabledAdapter = new ElasticDataAdapter(
        makeAdapterContext("Tenant A"),
        { ...baseProps, tenantIndexes: true },
    );
    const disabledAdapter = new ElasticDataAdapter(
        makeAdapterContext("Tenant A"),
        { ...baseProps, tenantIndexes: false },
    );

    assertEquals(defaultAdapter.physicalIndexName("Orders"), "tenant_a__orders");
    assertEquals(enabledAdapter.physicalIndexName("Orders"), "tenant_a__orders");
    assertEquals(disabledAdapter.physicalIndexName("Orders"), "orders");
    assertEquals(defaultAdapter.schemaIndexName(), "tenant_a__.schemas");
    assertEquals(disabledAdapter.schemaIndexName(), ".schemas");
    assertEquals(defaultAdapter.logicalIndexName("tenant_a__orders"), "orders");
    assertEquals(defaultAdapter.logicalIndexName("shared__orders"), null);
    assertEquals(disabledAdapter.logicalIndexName("orders"), "orders");
});

Deno.test("ElasticQueryAdapter tenantIndexes controls explicit and wildcard index names", () => {
    const baseProps = {
        host: "http://elastic",
        username: "user",
        password: "pass",
    };

    const defaultAdapter = new ElasticQueryAdapter(
        makeAdapterContext("Tenant A"),
        baseProps,
    );
    const enabledAdapter = new ElasticQueryAdapter(
        makeAdapterContext("Tenant A"),
        { ...baseProps, tenantIndexes: true },
    );
    const disabledAdapter = new ElasticQueryAdapter(
        makeAdapterContext("Tenant A"),
        { ...baseProps, tenantIndexes: false },
    );

    assertEquals(defaultAdapter.physicalIndexName("Orders"), "tenant_a__orders");
    assertEquals(enabledAdapter.physicalIndexName("Orders"), "tenant_a__orders");
    assertEquals(disabledAdapter.physicalIndexName("Orders"), "orders");
    assertEquals(defaultAdapter.tenantIndexWildcard(), "tenant_a__*");
    assertEquals(disabledAdapter.tenantIndexWildcard(), "*");
});
