import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { ICaptchaAdapter } from "../adapter/ICaptchaAdapter.ts";
import { CaptchaConfigurationError } from "../adapter/captchaCommon.ts";

interface CaptchaServiceConfig extends IServiceConfig {
  maxTokenLength?: number;
}

const DEFAULT_MAX_TOKEN_LENGTH = 4096;
const FALLBACK_TOKEN_FIELDS = ["captchaToken", "token"];

const service = new Service<ICaptchaAdapter, CaptchaServiceConfig>();

async function readBody(msg: Message): Promise<Record<string, unknown> | null> {
  if (!msg.data) return {};
  const mimeType = msg.data.mimeType.toLowerCase();
  if (
    !mimeType.startsWith("application/json") &&
    !mimeType.startsWith("application/x-www-form-urlencoded")
  ) {
    return null;
  }
  try {
    const body = await msg.data.asJson();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return null;
  }
}

function tokenFromBody(
  body: Record<string, unknown>,
  adapter: ICaptchaAdapter,
): string {
  const fieldNames = [...adapter.tokenFieldNames(), ...FALLBACK_TOKEN_FIELDS];
  for (const fieldName of fieldNames) {
    const value = body[fieldName];
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
  }
  return "";
}

service.get((msg, context: ServiceContext<ICaptchaAdapter>) => {
  return msg.setData(context.adapter.renderHtml(), "text/html");
});

service.post(
  async (
    msg,
    context: ServiceContext<ICaptchaAdapter>,
    config: CaptchaServiceConfig,
  ) => {
    const body = await readBody(msg);
    if (!body) return msg.setStatus(400, "Bad Captcha");

    const token = tokenFromBody(body, context.adapter);
    const maxTokenLength = config.maxTokenLength ?? DEFAULT_MAX_TOKEN_LENGTH;
    if (!token || token.length > maxTokenLength) {
      return msg.setStatus(400, "Bad Captcha");
    }

    try {
      const result = await context.adapter.verify(token, msg);
      if (!result.ok) return msg.setStatus(400, "Bad Captcha");
      msg.data = undefined;
      return msg.setStatus(0);
    } catch (err) {
      if (err instanceof CaptchaConfigurationError) {
        return msg.setStatus(500, err.message);
      }
      context.logger.error(`Captcha verification failed: ${err}`);
      return msg.setStatus(502, "Captcha verification failed");
    }
  },
);

export default service;
