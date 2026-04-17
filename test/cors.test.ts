import { assert, assertEquals } from "std/testing/asserts.ts";
import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ServiceWrapper } from "../ServiceWrapper.ts";
import { makeServerCorsSetter } from "../getServerConfig.ts";

Deno.test("CORS allows W3C trace context request headers", () => {
  const wrapper = new ServiceWrapper(new Service()) as any;
  const msg = new Message("/", "test", "GET", null)
    .setHeader("Access-Control-Allow-Headers", "TraceParent,X-Custom");

  wrapper.setCors(msg, "https://origin.example");

  const headers = (msg.getHeader("Access-Control-Allow-Headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase());

  assert(headers.includes("traceparent"));
  assert(headers.includes("tracestate"));
  assert(headers.includes("x-custom"));
  assertEquals(headers.filter((header) => header === "traceparent").length, 1);
  assertEquals(msg.getHeader("Vary"), "Origin");
  assertEquals(msg.getHeader("Access-Control-Allow-Credentials"), undefined);
});

Deno.test("CORS only allows credentials when requested by caller", () => {
  const wrapper = new ServiceWrapper(new Service()) as any;
  const msg = new Message("/", "test", "GET", null);

  wrapper.setCors(msg, "https://origin.example", true);

  assertEquals(msg.getHeader("Access-Control-Allow-Credentials"), "true");
});

Deno.test("server fallback CORS does not allow credentials", () => {
  const msg = new Message("/", "test", "OPTIONS", null)
    .setHeader("origin", "https://origin.example");

  makeServerCorsSetter()(msg);

  assertEquals(msg.getHeader("Access-Control-Allow-Origin"), "https://origin.example");
  assertEquals(msg.getHeader("Access-Control-Allow-Credentials"), undefined);
  assertEquals(msg.getHeader("Vary"), "Origin");
});
