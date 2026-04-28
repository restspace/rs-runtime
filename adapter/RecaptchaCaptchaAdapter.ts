import {
  escapeHtmlAttribute,
  FormPostCaptchaAdapter,
} from "./captchaCommon.ts";

export default class RecaptchaCaptchaAdapter extends FormPostCaptchaAdapter {
  defaultVerifyUrl = "https://www.google.com/recaptcha/api/siteverify";
  responseFieldName = "g-recaptcha-response";

  renderHtml(): string {
    return `<script src="https://www.google.com/recaptcha/api.js" async defer></script>
<div class="g-recaptcha" data-sitekey="${
      escapeHtmlAttribute(this.props.siteKey)
    }"></div>`;
  }
}
