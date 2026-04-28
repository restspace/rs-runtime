import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { Message } from "rs-core/Message.ts";

export interface CaptchaVerifyResult {
  ok: boolean;
  providerStatus?: unknown;
}

export interface ICaptchaAdapter extends IAdapter {
  renderHtml(): string;
  tokenFieldNames(): string[];
  verify(token: string, request: Message): Promise<CaptchaVerifyResult>;
}
