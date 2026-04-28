import { Message } from "rs-core/Message.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { CaptchaVerifyResult, ICaptchaAdapter } from "./ICaptchaAdapter.ts";

export interface CaptchaAdapterConfig {
  siteKey?: string;
  secretKey?: string;
  secretKeyEnvVar?: string;
  verifyUrl?: string;
  expectedHostname?: string;
}

export class CaptchaConfigurationError extends Error {
  constructor(message = "Captcha secret is not configured") {
    super(message);
    this.name = "CaptchaConfigurationError";
  }
}

export class CaptchaVerificationError extends Error {
  constructor(message = "Captcha verification failed") {
    super(message);
    this.name = "CaptchaVerificationError";
  }
}

export abstract class FormPostCaptchaAdapter implements ICaptchaAdapter {
  abstract defaultVerifyUrl: string;
  abstract responseFieldName: string;

  constructor(
    public context: AdapterContext,
    public props: CaptchaAdapterConfig,
  ) {}

  abstract renderHtml(): string;

  tokenFieldNames(): string[] {
    return [this.responseFieldName];
  }

  protected secret(): string {
    const secret = this.props.secretKey ||
      (this.props.secretKeyEnvVar
        ? Deno.env.get(this.props.secretKeyEnvVar)
        : undefined);
    if (!secret) throw new CaptchaConfigurationError();
    return secret;
  }

  protected remoteIp(request: Message): string | undefined {
    return request.getHeader("cf-connecting-ip") ||
      request.getHeader("x-real-ip") ||
      request.getHeader("x-forwarded-for")?.split(",")[0].trim();
  }

  protected verificationParams(
    token: string,
    request: Message,
  ): URLSearchParams {
    const params = new URLSearchParams({
      secret: this.secret(),
      response: token,
    });
    const remoteip = this.remoteIp(request);
    if (remoteip) params.set("remoteip", remoteip);
    return params;
  }

  async verify(token: string, request: Message): Promise<CaptchaVerifyResult> {
    const verifyUrl = this.props.verifyUrl || this.defaultVerifyUrl;
    const params = this.verificationParams(token, request);
    const msg = new Message(verifyUrl, this.context.tenant, "POST", null);
    msg.setData(params.toString(), "application/x-www-form-urlencoded");

    let response: Message;
    try {
      response = await this.context.makeRequest(msg);
    } catch (err) {
      throw new CaptchaVerificationError(
        `Captcha verification transport failed: ${err}`,
      );
    }

    if (!response.ok || !response.data) {
      throw new CaptchaVerificationError(
        "Captcha verifier returned an error response",
      );
    }

    let providerStatus: any;
    try {
      providerStatus = await response.data.asJson();
    } catch (err) {
      throw new CaptchaVerificationError(
        `Captcha verifier returned malformed JSON: ${err}`,
      );
    }

    if (!providerStatus?.success) {
      return { ok: false, providerStatus };
    }
    if (
      this.props.expectedHostname &&
      providerStatus.hostname !== this.props.expectedHostname
    ) {
      return { ok: false, providerStatus };
    }
    return { ok: true, providerStatus };
  }
}

export function escapeHtmlAttribute(value: string | undefined): string {
  return (value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
