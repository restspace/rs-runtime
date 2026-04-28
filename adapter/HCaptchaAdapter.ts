import {
  escapeHtmlAttribute,
  FormPostCaptchaAdapter,
} from "./captchaCommon.ts";
import { Message } from "rs-core/Message.ts";

export default class HCaptchaAdapter extends FormPostCaptchaAdapter {
  defaultVerifyUrl = "https://api.hcaptcha.com/siteverify";
  responseFieldName = "h-captcha-response";

  renderHtml(): string {
    return `<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<div class="h-captcha" data-sitekey="${
      escapeHtmlAttribute(this.props.siteKey)
    }"></div>`;
  }

  protected override verificationParams(
    token: string,
    request: Message,
  ): URLSearchParams {
    const params = super.verificationParams(token, request);
    if (this.props.siteKey) params.set("sitekey", this.props.siteKey);
    return params;
  }
}
