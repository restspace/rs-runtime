import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { userIsAnon } from "rs-core/user/IAuthUser.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { getUserFromEmail, saveUser } from "rs-core/user/userManagement.ts";
import { buildOtpAuthUrl, decryptUtf8, encryptUtf8, EncryptedBlob, generateTotpSecretBase32, verifyTotpCode } from "../auth/totp.ts";
import { qrcode } from "jsr:@libs/qrcode@3.0.1";
import { OperationSpec, ViewSpec } from "rs-core/DirDescriptor.ts";

interface TotpConfig extends IServiceConfig {
    userUrlPattern: string;
    issuer?: string;
    digits?: number;
    periodSeconds?: number;
    skewSteps?: number;
    masterKeyEnvVar?: string;
    lockout?: {
        maxAttempts?: number;
        lockMinutes?: number;
    };
}

type StoredTotp = {
    enabled?: boolean;
    confirmedAt?: string;
    digits?: number;
    periodSeconds?: number;
    issuer?: string;
    secretEnc?: EncryptedBlob;
    failedAttempts?: number;
    lockUntil?: string;
};

function issuerForConfig(config: TotpConfig, msg: Message): string {
    return config.issuer || msg.url.domain || "restspace";
}

function lockoutParams(config: TotpConfig): { maxAttempts: number; lockMinutes: number } {
    const maxAttempts = config.lockout?.maxAttempts ?? 5;
    const lockMinutes = config.lockout?.lockMinutes ?? 10;
    return { maxAttempts, lockMinutes };
}

function nowIso(): string {
    return new Date().toISOString();
}

function isLocked(totp: StoredTotp | undefined): boolean {
    if (!totp?.lockUntil) return false;
    const until = new Date(totp.lockUntil).getTime();
    return until > Date.now();
}

function redactTotpForClient(totp: StoredTotp | undefined) {
    if (!totp) return undefined;
    return {
        enabled: !!totp.enabled,
        confirmedAt: totp.confirmedAt,
        digits: totp.digits,
        periodSeconds: totp.periodSeconds,
        issuer: totp.issuer
    };
}

const service = new Service<IAdapter, TotpConfig>();

service.getPath("enroll-page", async (msg, context, config) => {
    if (!msg.user || userIsAnon(msg.user)) {
        return msg.setStatus(401, "Unauthorized");
    }

    const user = await getUserFromEmail(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, msg.user.email, true);
    if (!user) return msg.setStatus(404, "No such user");

    const issuer = issuerForConfig(config, msg);
    const digits = config.digits ?? 6;
    const periodSeconds = config.periodSeconds ?? 30;

    let totp = (user as any).totp as StoredTotp | undefined;
    let secret: string;
    if (!totp?.secretEnc) {
        secret = generateTotpSecretBase32(20);
        const secretEnc = await encryptUtf8(secret, config.masterKeyEnvVar || "RS_TOTP_MASTER_KEY");
        totp = {
            enabled: false,
            digits,
            periodSeconds,
            issuer,
            secretEnc
        } satisfies StoredTotp;
        (user as any).totp = totp;
        (user as any).mfaEnabled = false;
        const saved = await saveUser(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, user, true);
        if (!saved.ok) return saved;
    } else {
        secret = await decryptUtf8(totp.secretEnc, config.masterKeyEnvVar || "RS_TOTP_MASTER_KEY");
    }

    const otpauthUrl = buildOtpAuthUrl(issuer, msg.user.email, secret, { digits: totp?.digits ?? digits, periodSeconds: totp?.periodSeconds ?? periodSeconds });
    const svg = qrcode(otpauthUrl, { output: "svg" });

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Set up authenticator</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #111; }
      .card { max-width: 560px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; }
      .qr { width: 220px; height: 220px; margin: 16px 0; }
      .qr svg { width: 220px; height: 220px; display: block; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
      .muted { color: #6b7280; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Set up Google Authenticator</h2>
      <div class="muted">Scan this QR code with Google Authenticator (or any TOTP app), then return to the app to enter the 6-digit code to confirm.</div>
      <div class="qr">${svg}</div>
      <div class="muted">After scanning, POST <code>/mfa/confirm</code> with <code>{"code":"123456"}</code>.</div>
    </div>
  </body>
</html>`;

    return msg.setData(html, "text/html");
});

service.postPath("enroll", async (msg, context, config) => {
    if (!msg.user || userIsAnon(msg.user)) {
        return msg.setStatus(401, "Unauthorized");
    }
    const user = await getUserFromEmail(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, msg.user.email, true);
    if (!user) return msg.setStatus(404, "No such user");

    const issuer = issuerForConfig(config, msg);
    const digits = config.digits ?? 6;
    const periodSeconds = config.periodSeconds ?? 30;
    const secret = generateTotpSecretBase32(20);
    const secretEnc = await encryptUtf8(secret, config.masterKeyEnvVar || "RS_TOTP_MASTER_KEY");

    (user as any).totp = {
        enabled: false,
        digits,
        periodSeconds,
        issuer,
        secretEnc
    } satisfies StoredTotp;
    (user as any).mfaEnabled = false;

    const saved = await saveUser(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, user, true);
    if (!saved.ok) return saved;

    const otpauthUrl = buildOtpAuthUrl(issuer, msg.user.email, secret, { digits, periodSeconds });
    return msg.setDataJson({
        otpauthUrl,
        totp: redactTotpForClient((user as any).totp)
    });
});

service.postPath("confirm", async (msg, context, config) => {
    if (!msg.user || userIsAnon(msg.user)) {
        return msg.setStatus(401, "Unauthorized");
    }
    const body = msg.data ? await msg.data.asJson().catch(() => ({} as any)) : ({} as any);
    const code = (body?.code || "").toString();

    const user = await getUserFromEmail(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, msg.user.email, true);
    if (!user) return msg.setStatus(404, "No such user");
    const totp = (user as any).totp as StoredTotp | undefined;
    if (!totp?.secretEnc) return msg.setStatus(400, "TOTP not enrolled");
    if (isLocked(totp)) return msg.setStatus(423, "Locked");

    const secret = await decryptUtf8(totp.secretEnc, config.masterKeyEnvVar || "RS_TOTP_MASTER_KEY");
    const ok = await verifyTotpCode(secret, code, Date.now(), {
        digits: totp.digits ?? config.digits,
        periodSeconds: totp.periodSeconds ?? config.periodSeconds,
        skewSteps: config.skewSteps ?? 1
    });
    if (!ok) {
        return msg.setStatus(400, "Bad code");
    }

    (user as any).totp = {
        ...totp,
        enabled: true,
        confirmedAt: nowIso(),
        failedAttempts: 0,
        lockUntil: undefined
    } satisfies StoredTotp;
    (user as any).mfaEnabled = true;

    const saved = await saveUser(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, user, true);
    if (!saved.ok) return saved;
    return msg.setDataJson({ ok: true, totp: redactTotpForClient((user as any).totp), mfaEnabled: true });
});

service.postPath("disable", async (msg, context, config) => {
    if (!msg.user || userIsAnon(msg.user)) {
        return msg.setStatus(401, "Unauthorized");
    }
    const body = msg.data ? await msg.data.asJson().catch(() => ({} as any)) : ({} as any);
    const code = (body?.code || "").toString();

    const user = await getUserFromEmail(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, msg.user.email, true);
    if (!user) return msg.setStatus(404, "No such user");
    const totp = (user as any).totp as StoredTotp | undefined;
    if (!totp?.secretEnc) return msg.setStatus(400, "TOTP not enrolled");
    if (isLocked(totp)) return msg.setStatus(423, "Locked");

    const secret = await decryptUtf8(totp.secretEnc, config.masterKeyEnvVar || "RS_TOTP_MASTER_KEY");
    const ok = await verifyTotpCode(secret, code, Date.now(), {
        digits: totp.digits ?? config.digits,
        periodSeconds: totp.periodSeconds ?? config.periodSeconds,
        skewSteps: config.skewSteps ?? 1
    });
    if (!ok) {
        return msg.setStatus(400, "Bad code");
    }

    (user as any).totp = undefined;
    (user as any).mfaEnabled = false;
    const saved = await saveUser(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, user, true);
    if (!saved.ok) return saved;
    return msg.setDataJson({ ok: true, mfaEnabled: false });
});

// Internal use: POST /verify { email, code } -> { ok, locked }
service.postPath("verify", async (msg, context, config) => {
    const body = msg.data ? await msg.data.asJson().catch(() => ({} as any)) : ({} as any);
    const email = (body?.email || "").toString();
    const code = (body?.code || "").toString();
    if (!email || !code) return msg.setStatus(400, "Missing email or code");

    // This endpoint is intended to be called from auth flows before rs-auth exists.
    // Require internal privilege to avoid making it an oracle.
    if (!msg.internalPrivilege) {
        return msg.setStatus(403, "Forbidden");
    }

    const user = await getUserFromEmail(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, email, true);
    if (!user) return msg.setStatus(404, "No such user");
    const totp = (user as any).totp as StoredTotp | undefined;
    if (!totp?.enabled || !totp.secretEnc) {
        return msg.setDataJson({ ok: true, required: false });
    }

    if (isLocked(totp)) {
        return msg.setDataJson({ ok: false, required: true, locked: true });
    }

    const secret = await decryptUtf8(totp.secretEnc, config.masterKeyEnvVar || "RS_TOTP_MASTER_KEY");
    const ok = await verifyTotpCode(secret, code, Date.now(), {
        digits: totp.digits ?? config.digits,
        periodSeconds: totp.periodSeconds ?? config.periodSeconds,
        skewSteps: config.skewSteps ?? 1
    });

    const { maxAttempts, lockMinutes } = lockoutParams(config);
    const nextTotp: StoredTotp = { ...totp };
    if (ok) {
        nextTotp.failedAttempts = 0;
        nextTotp.lockUntil = undefined;
    } else {
        const attempts = (nextTotp.failedAttempts ?? 0) + 1;
        nextTotp.failedAttempts = attempts;
        if (attempts >= maxAttempts) {
            const lockUntil = new Date();
            lockUntil.setMinutes(lockUntil.getMinutes() + lockMinutes);
            nextTotp.lockUntil = lockUntil.toISOString();
        }
    }
    (user as any).totp = nextTotp;
    await saveUser(context as unknown as SimpleServiceContext, config.userUrlPattern, msg, user, true);

    return msg.setDataJson({ ok, required: true, locked: !ok && isLocked(nextTotp) });
});

service.constantDirectory("/", {
    path: "/",
    paths: [
        [ "enroll-page", 0, { pattern: "view" } as ViewSpec ],
        [ "enroll", 0, { pattern: "operation" } as OperationSpec ],
        [ "confirm", 0, { pattern: "operation" } as OperationSpec ],
        [ "disable", 0, { pattern: "operation" } as OperationSpec ],
        [ "verify", 0, { pattern: "operation" } as OperationSpec ]
    ],
    spec: {
        pattern: "directory"
    }
});

export default service;

