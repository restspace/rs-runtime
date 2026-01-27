export interface TotpOptions {
    digits?: number;
    periodSeconds?: number;
    skewSteps?: number;
}

function encodeBase64(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) {
        bin += String.fromCharCode(b);
    }
    return btoa(bin);
}

function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    // Deno 2 typings are strict about ArrayBuffer vs SharedArrayBuffer; force a copy.
    const copy = new Uint8Array(bytes);
    return copy.buffer;
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32CharToValue(c: string): number {
    const idx = base32Alphabet.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base32 char: ${c}`);
    return idx;
}

export function base32Decode(base32: string): Uint8Array {
    const clean = base32.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
        value = (value << 5) | base32CharToValue(ch);
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out.push((value >> bits) & 0xff);
        }
    }
    return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let out = "";
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += base32Alphabet[(value >> bits) & 31];
        }
    }
    if (bits > 0) {
        out += base32Alphabet[(value << (5 - bits)) & 31];
    }
    return out;
}

export function generateTotpSecretBase32(byteLength = 20): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return base32Encode(bytes);
}

export function buildOtpAuthUrl(issuer: string, accountName: string, secretBase32: string, opts?: TotpOptions): string {
    const digits = opts?.digits ?? 6;
    const period = opts?.periodSeconds ?? 30;
    const label = `${issuer}:${accountName}`;
    const u = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
    u.searchParams.set("secret", secretBase32);
    u.searchParams.set("issuer", issuer);
    u.searchParams.set("digits", digits.toString());
    u.searchParams.set("period", period.toString());
    return u.toString();
}

function toBigEndianCounter(counter: bigint): Uint8Array {
    const buf = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) {
        buf[i] = Number(c & 0xffn);
        c >>= 8n;
    }
    return buf;
}

async function hmacSha1(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const keyData = asArrayBuffer(keyBytes);
    const msgData = asArrayBuffer(message);
    const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-1" },
        false,
        [ "sign" ]
    );
    const sig = await crypto.subtle.sign("HMAC", key, msgData);
    return new Uint8Array(sig);
}

export async function totpCodeFromSecretBase32(secretBase32: string, nowMs = Date.now(), opts?: TotpOptions): Promise<string> {
    const digits = opts?.digits ?? 6;
    const period = opts?.periodSeconds ?? 30;
    const counter = BigInt(Math.floor(nowMs / 1000 / period));
    const keyBytes = base32Decode(secretBase32);
    const hmac = await hmacSha1(keyBytes, toBigEndianCounter(counter));
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binCode = ((hmac[offset] & 0x7f) << 24)
        | ((hmac[offset + 1] & 0xff) << 16)
        | ((hmac[offset + 2] & 0xff) << 8)
        | (hmac[offset + 3] & 0xff);
    const mod = 10 ** digits;
    const code = (binCode % mod).toString().padStart(digits, "0");
    return code;
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let res = 0;
    for (let i = 0; i < a.length; i++) {
        res |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return res === 0;
}

export async function verifyTotpCode(secretBase32: string, code: string, nowMs = Date.now(), opts?: TotpOptions): Promise<boolean> {
    const skew = opts?.skewSteps ?? 1;
    const digits = opts?.digits ?? 6;
    const period = opts?.periodSeconds ?? 30;
    const cleanCode = (code || "").trim();
    if (!/^\d+$/.test(cleanCode)) return false;
    if (cleanCode.length !== digits) return false;

    for (let i = -skew; i <= skew; i++) {
        const t = nowMs + i * period * 1000;
        const expected = await totpCodeFromSecretBase32(secretBase32, t, { digits, periodSeconds: period });
        if (timingSafeEqual(expected, cleanCode)) return true;
    }
    return false;
}

export interface EncryptedBlob {
    alg: "AES-GCM";
    iv: string;
    ct: string;
}

async function importAesGcmKeyFromEnv(envVar = "RS_TOTP_MASTER_KEY"): Promise<CryptoKey> {
    const raw = Deno.env.get(envVar) || "";
    if (!raw) {
        throw new Error(`${envVar} is not set`);
    }
    const bytes = decodeBase64(raw);
    if (bytes.length < 32) {
        throw new Error(`${envVar} must be base64 for at least 32 bytes`);
    }
    return await crypto.subtle.importKey("raw", asArrayBuffer(bytes.slice(0, 32)), "AES-GCM", false, [ "encrypt", "decrypt" ]);
}

export async function encryptUtf8(plainText: string, envVar = "RS_TOTP_MASTER_KEY"): Promise<EncryptedBlob> {
    const key = await importAesGcmKeyFromEnv(envVar);
    const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)));
    const pt = new Uint8Array(new TextEncoder().encode(plainText));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, asArrayBuffer(pt));
    return { alg: "AES-GCM", iv: encodeBase64(iv), ct: encodeBase64(new Uint8Array(ct)) };
}

export async function decryptUtf8(blob: EncryptedBlob, envVar = "RS_TOTP_MASTER_KEY"): Promise<string> {
    if (!blob || blob.alg !== "AES-GCM") throw new Error("Unsupported encryption blob");
    const key = await importAesGcmKeyFromEnv(envVar);
    const iv = new Uint8Array(decodeBase64(blob.iv));
    const ct = new Uint8Array(decodeBase64(blob.ct));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, asArrayBuffer(ct));
    return new TextDecoder().decode(new Uint8Array(pt));
}

