import {
  escapeHtmlAttribute,
  FormPostCaptchaAdapter,
} from "./captchaCommon.ts";

export default class TurnstileCaptchaAdapter extends FormPostCaptchaAdapter {
  defaultVerifyUrl =
    "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  responseFieldName = "cf-turnstile-response";

  renderHtml(): string {
    return `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="${
      escapeHtmlAttribute(this.props.siteKey)
    }"></div>`;
  }
}
