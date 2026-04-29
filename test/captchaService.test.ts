import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "std/testing/asserts.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import captchaService from "../services/captcha.ts";
import {
  CaptchaVerifyResult,
  ICaptchaAdapter,
} from "../adapter/ICaptchaAdapter.ts";
import { CaptchaConfigurationError } from "../adapter/captchaCommon.ts";
import TurnstileCaptchaAdapter from "../adapter/TurnstileCaptchaAdapter.ts";
import RecaptchaCaptchaAdapter from "../adapter/RecaptchaCaptchaAdapter.ts";
import HCaptchaAdapter from "../adapter/HCaptchaAdapter.ts";
import { makeAdapterContext } from "./testUtility.ts";
import { config } from "../config.ts";
import { testServerConfig } from "./testServerConfig.ts";

config.server = testServerConfig;

class MockCaptchaAdapter implements ICaptchaAdapter {
  props: Record<string, any> = {};
  context = makeAdapterContext("captcha");
  fields = ["mock-captcha-response"];
  html = "<div>captcha</div>";
  result: CaptchaVerifyResult = { ok: true };
  error?: Error;
  verifiedTokens: string[] = [];

  renderHtml(): string {
    return this.html;
  }

  tokenFieldNames(): string[] {
    return this.fields;
  }

  verify(token: string): Promise<CaptchaVerifyResult> {
    this.verifiedTokens.push(token);
    if (this.error) throw this.error;
    return Promise.resolve(this.result);
  }
}

type CaptchaAdapterConstructor = new (
  context: ReturnType<typeof makeAdapterContext>,
  props: Record<string, unknown>,
) => ICaptchaAdapter;

function testMessage(method: MessageMethod): Message {
  return new Message("/captcha", "captcha", method, null)
    .setHeader("host", "captcha.restspace.local:3100");
}

function testDirectoryMessage(method: MessageMethod): Message {
  return new Message("/", "captcha", method, null)
    .setHeader("host", "captcha.restspace.local:3100");
}

function serviceContext(
  adapter: ICaptchaAdapter,
): ServiceContext<ICaptchaAdapter> {
  return {
    ...makeAdapterContext("captcha"),
    manifest: {},
    adapter,
  } as ServiceContext<ICaptchaAdapter>;
}

async function callService(
  msg: Message,
  adapter: ICaptchaAdapter,
  serviceConfig: Record<string, unknown> = {},
): Promise<Message> {
  return await captchaService.func(msg, serviceContext(adapter), {
    name: "Captcha",
    source: "./services/captcha.rsm.json",
    basePath: "/captcha",
    ...serviceConfig,
  } as any);
}

function responseWithJson(value: unknown): () => Message {
  return () => new Message("/", "captcha", "POST", null).setDataJson(value);
}

Deno.test("captcha service GET renders adapter HTML", async () => {
  const adapter = new MockCaptchaAdapter();
  adapter.html = '<div class="mock-captcha"></div>';

  const msgOut = await callService(testMessage("GET"), adapter);

  assertEquals(msgOut.status, 0);
  assertEquals(msgOut.data?.mimeType, "text/html");
  assertEquals(await msgOut.data?.asString(), adapter.html);
});

Deno.test("captcha service describes challenge and verify paths", async () => {
  const adapter = new MockCaptchaAdapter();

  const msgOut = await callService(testDirectoryMessage("GET"), adapter);
  const dir = await msgOut.data?.asJson();

  assertEquals(msgOut.status, 0);
  assertEquals(msgOut.data?.mimeType, "inode/directory+json");
  assertEquals(dir.paths, [
    ["challenge", 0, { pattern: "view", respMimeType: "text/html" }],
    ["verify", 0, { pattern: "operation", reqMimeType: "application/json" }],
  ]);
});

Deno.test("captcha service POST accepts native and fallback token fields", async () => {
  const adapter = new MockCaptchaAdapter();

  let msgOut = await callService(
    testMessage("POST").setData(
      "mock-captcha-response=native-token",
      "application/x-www-form-urlencoded",
    ),
    adapter,
  );
  assertEquals(msgOut.status, 0);
  assert(msgOut.data);
  assertEquals(await msgOut.data.asJson(), {
    "mock-captcha-response": "native-token",
  });
  assertEquals(adapter.verifiedTokens[0], "native-token");

  msgOut = await callService(
    testMessage("POST").setDataJson({ token: "generic-token" }),
    adapter,
  );
  assertEquals(msgOut.status, 0);
  assertEquals(await msgOut.data?.asJson(), { token: "generic-token" });
  assertEquals(adapter.verifiedTokens[1], "generic-token");
});

Deno.test("captcha service rejects missing oversized and failed tokens", async () => {
  const adapter = new MockCaptchaAdapter();

  let msgOut = await callService(
    testMessage("POST").setDataJson({ token: "" }),
    adapter,
  );
  assertEquals(msgOut.status, 400);
  assertEquals(await msgOut.data?.asString(), "Bad Captcha");

  msgOut = await callService(
    testMessage("POST").setDataJson({ token: "abcd" }),
    adapter,
    { maxTokenLength: 3 },
  );
  assertEquals(msgOut.status, 400);

  adapter.result = { ok: false, providerStatus: { success: false } };
  msgOut = await callService(
    testMessage("POST").setDataJson({ token: "bad-token" }),
    adapter,
  );
  assertEquals(msgOut.status, 400);
});

Deno.test("captcha service maps adapter errors to configured statuses", async () => {
  const adapter = new MockCaptchaAdapter();

  adapter.error = new CaptchaConfigurationError();
  let msgOut = await callService(
    testMessage("POST").setDataJson({ token: "abc" }),
    adapter,
  );
  assertEquals(msgOut.status, 500);
  assertEquals(
    await msgOut.data?.asString(),
    "Captcha secret is not configured",
  );

  adapter.error = new Error("provider unavailable");
  msgOut = await callService(
    testMessage("POST").setDataJson({ token: "abc" }),
    adapter,
  );
  assertEquals(msgOut.status, 502);
  assertEquals(await msgOut.data?.asString(), "Captcha verification failed");
});

const providerCases = [
  {
    name: "Turnstile",
    Adapter: TurnstileCaptchaAdapter,
    field: "cf-turnstile-response",
    script: "https://challenges.cloudflare.com/turnstile/v0/api.js",
    widgetClass: "cf-turnstile",
  },
  {
    name: "reCAPTCHA",
    Adapter: RecaptchaCaptchaAdapter,
    field: "g-recaptcha-response",
    script: "https://www.google.com/recaptcha/api.js",
    widgetClass: "g-recaptcha",
  },
  {
    name: "hCaptcha",
    Adapter: HCaptchaAdapter,
    field: "h-captcha-response",
    script: "https://js.hcaptcha.com/1/api.js",
    widgetClass: "h-captcha",
  },
];

function providerAdapter(
  Adapter: CaptchaAdapterConstructor,
  providerResponse: (msg: Message) => Promise<Message> | Message,
  props: Record<string, unknown> = {},
): { adapter: ICaptchaAdapter; requests: Message[] } {
  const requests: Message[] = [];
  const context = {
    ...makeAdapterContext("captcha"),
    makeRequest: async (msg: Message) => {
      requests.push(msg);
      return await providerResponse(msg);
    },
  };
  return {
    adapter: new Adapter(context, {
      siteKey: "site-key",
      secretKey: "secret-key",
      verifyUrl: "https://captcha.test/siteverify",
      expectedHostname: "example.test",
      ...props,
    }),
    requests,
  };
}

for (const provider of providerCases) {
  Deno.test(`${provider.name} adapter renders provider snippet`, () => {
    const { adapter } = providerAdapter(
      provider.Adapter,
      responseWithJson({ success: true }),
    );
    const html = adapter.renderHtml();

    assertStringIncludes(html, provider.script);
    assertStringIncludes(html, "site-key");
    assertStringIncludes(html, provider.widgetClass);
  });

  Deno.test(`${provider.name} adapter accepts provider native form field`, async () => {
    const { adapter, requests } = providerAdapter(
      provider.Adapter,
      responseWithJson({ success: true, hostname: "example.test" }),
    );
    const msg = testMessage("POST")
      .setHeader("x-forwarded-for", "203.0.113.7, 10.0.0.1")
      .setData(
        `${encodeURIComponent(provider.field)}=native-token`,
        "application/x-www-form-urlencoded",
      );

    const msgOut = await callService(msg, adapter);

    assertEquals(msgOut.status, 0);
    assertEquals(requests.length, 1);
    const body = await requests[0].data?.asJson();
    assertEquals(body.secret, "secret-key");
    assertEquals(body.response, "native-token");
    assertEquals(body.remoteip, "203.0.113.7");
    if (provider.name === "hCaptcha") {
      assertEquals(body.sitekey, "site-key");
    }
  });

  Deno.test(`${provider.name} adapter accepts generic JSON token`, async () => {
    const { adapter, requests } = providerAdapter(
      provider.Adapter,
      responseWithJson({ success: true, hostname: "example.test" }),
    );

    const msgOut = await callService(
      testMessage("POST").setDataJson({ token: "generic-token" }),
      adapter,
    );

    assertEquals(msgOut.status, 0);
    const body = await requests[0].data?.asJson();
    assertEquals(body.response, "generic-token");
  });

  Deno.test(`${provider.name} adapter maps provider failure to bad captcha`, async () => {
    const { adapter } = providerAdapter(
      provider.Adapter,
      responseWithJson({ success: false }),
    );

    const msgOut = await callService(
      testMessage("POST").setDataJson({ token: "bad-token" }),
      adapter,
    );

    assertEquals(msgOut.status, 400);
    assertEquals(await msgOut.data?.asString(), "Bad Captcha");
  });

  Deno.test(`${provider.name} adapter maps verifier error responses to bad gateway`, async () => {
    const { adapter } = providerAdapter(
      provider.Adapter,
      () =>
        new Message("/", "captcha", "POST", null).setStatus(503, "unavailable"),
    );

    const msgOut = await callService(
      testMessage("POST").setDataJson({ token: "abc" }),
      adapter,
    );

    assertEquals(msgOut.status, 502);
    assertEquals(await msgOut.data?.asString(), "Captcha verification failed");
  });

  Deno.test(`${provider.name} adapter maps malformed verifier responses to bad gateway`, async () => {
    const { adapter } = providerAdapter(
      provider.Adapter,
      () =>
        new Message("/", "captcha", "POST", null).setData(
          "not-json",
          "application/json",
        ),
    );

    const msgOut = await callService(
      testMessage("POST").setDataJson({ token: "abc" }),
      adapter,
    );

    assertEquals(msgOut.status, 502);
    assertEquals(await msgOut.data?.asString(), "Captcha verification failed");
  });

  Deno.test(`${provider.name} adapter rejects expected hostname mismatch`, async () => {
    const { adapter } = providerAdapter(
      provider.Adapter,
      responseWithJson({ success: true, hostname: "other.example.test" }),
    );

    const msgOut = await callService(
      testMessage("POST").setDataJson({ token: "abc" }),
      adapter,
    );

    assertEquals(msgOut.status, 400);
    assertEquals(await msgOut.data?.asString(), "Bad Captcha");
  });

  Deno.test(`${provider.name} adapter reports missing secret as server error`, async () => {
    const { adapter } = providerAdapter(
      provider.Adapter,
      responseWithJson({ success: true, hostname: "example.test" }),
      { secretKey: undefined, secretKeyEnvVar: undefined },
    );

    const msgOut = await callService(
      testMessage("POST").setDataJson({ token: "abc" }),
      adapter,
    );

    assertEquals(msgOut.status, 500);
    assertEquals(
      await msgOut.data?.asString(),
      "Captcha secret is not configured",
    );
  });
}

Deno.test("captcha service is registered as a built-in manifest", () => {
  assert(config.modules.serviceManifests["./services/captcha.rsm.json"]);
  assert(
    config.modules
      .adapterManifests["./adapter/TurnstileCaptchaAdapter.ram.json"],
  );
  assert(
    config.modules
      .adapterManifests["./adapter/RecaptchaCaptchaAdapter.ram.json"],
  );
  assert(config.modules.adapterManifests["./adapter/HCaptchaAdapter.ram.json"]);
});
