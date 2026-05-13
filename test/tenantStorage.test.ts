import { assertEquals } from "std/testing/asserts.ts";
import {
  prefixStorageName,
  tenantPathSegment,
  tenantStoragePrefix,
  unprefixStorageName,
} from "../adapter/tenantStorage.ts";

Deno.test("tenant storage helpers use readable sanitized prefixes", () => {
  assertEquals(tenantStoragePrefix("Acme Co./West"), "Acme_Co_West");
  assertEquals(
    tenantStoragePrefix("Acme Co./West", { lowerCase: true }),
    "acme_co_west",
  );
  assertEquals(tenantPathSegment("Acme Co./West"), "Acme_Co_West");
});

Deno.test("tenant storage helpers prefix and strip only the current tenant", () => {
  const physical = prefixStorageName("tenant-a", "orders", { maxLength: 120 });
  assertEquals(physical, "tenant-a__orders");
  assertEquals(unprefixStorageName("tenant-a", physical), "orders");
  assertEquals(unprefixStorageName("tenant-b", physical), null);
});

Deno.test("tenant storage helpers enforce max physical name length", () => {
  const physical = prefixStorageName("tenant", "x".repeat(200), {
    maxLength: 32,
  });
  assertEquals(physical.length, 32);
  assertEquals(physical.startsWith("tenant__"), true);
});
