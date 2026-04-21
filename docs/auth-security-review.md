# Security Review: `services/auth.ts`, `auth/AuthUser.ts`, `auth/Authoriser.ts`

Findings grouped by severity. File/line references are relative to the repo root.

---

## High severity

### H1. HMAC signing key is ephemeral, per-process, and non-extractable — breaks horizontal scaling and invalidates all sessions on restart
`auth/Authoriser.ts:35-47`

```ts
private async ensureKey() {
    if (!this.key) {
        this.key = await crypto.subtle.generateKey(
            { name: "HMAC", hash: "SHA-512" },
            false,  // extractable = false
            [ "sign", "verify" ]
        );
    }
    return this.key;
}
```

- The HMAC secret is generated randomly on first use and only lives in memory. Restarting the process silently invalidates every JWT — and more importantly, **in a multi-instance deployment each instance signs with a different key**, so JWTs issued by instance A will fail verification on instance B (or, if sticky sessions mask it, session continuity is wholly up to luck).
- Because it's `extractable: false`, there's no way to persist or share it.
- There is no mechanism for key rotation, no `kid` header, and no list of accepted keys during rollover.

**Recommendation:** load the HMAC secret (or better, an asymmetric key pair using RS256/EdDSA) from configuration/secret store; support a list of verification keys plus a single signing key with `kid` for rotation.

---

### H2. Login redirect validation allows open redirect via protocol-relative URLs and scheme mismatch
`services/auth.ts:263-285`

```ts
if (redirUrl.query['redirect']?.length) {
    const redirectTarget = redirUrl.query['redirect'][0];
    let isValidRedirect = false;
    try {
        const redirectUrl = new Url(redirectTarget);
        // Allow relative paths (no domain) or same origin (same scheme + domain)
        isValidRedirect = !redirectUrl.domain || (redirectUrl.scheme === msg.url.scheme && redirectUrl.domain === msg.url.domain);
    } catch {}
```

Depending on how `rs-core/Url.ts` parses inputs, common open-redirect bypasses aren't obviously covered:

- **Protocol-relative URLs** (`//evil.com/path`) — if `Url` treats the leading `//` as "no scheme", `redirectUrl.domain` may still be `evil.com` while `redirectUrl.scheme` is empty, which would fail the scheme/domain equality check — but if `Url` normalises `//evil.com` to path `evil.com` with no domain, it would be treated as "no domain" and allowed.
- **Backslash tricks** (`/\evil.com`, `\\evil.com`) — some browsers rewrite `\` to `/` before following the redirect, so any parser that doesn't normalise these risks an open redirect.
- **Userinfo smuggling** (`http://legit.com@evil.com`) is handled only if `Url.domain` is strictly the authority host.
- **Data/JavaScript URIs** (`javascript:...`, `data:text/html,...`) — the check only compares scheme/domain; a URI where both the target and request scheme are e.g. `http://` would be rejected, but if the input has no parsable scheme/domain (so `!redirectUrl.domain` is true), `javascript:alert(1)` could slip through unless `Url` rejects it.

Also note the redirect *param* is read from the `referer`'s query string, not the current request's. An attacker controlling the `referer` (they do — they write the page that redirects to `/login`) can inject arbitrary `?redirect=` values.

**Recommendation:** parse with a strict allowlist — require the redirect to start with a single `/` that is not followed by another `/` or `\`; reject any value containing `:`, `//`, or `\`; or explicitly resolve against the current origin and refuse anything whose resolved origin ≠ current origin.

---

### H3. `AuthUser` constructor does bulk `Object.assign` and is used for both JWT payloads and DB records — only a code-comment protects against privilege escalation
`auth/AuthUser.ts:23-31`

```ts
constructor(userObj: Partial<IAuthUser>) {
    if (userObj) {
        // SECURITY NOTE: This constructor should only be called with trusted input
        // (JWT payloads, database records, test data). Do NOT pass unsanitized request
        // bodies directly. API endpoints must validate and whitelist fields before
        // constructing AuthUser to prevent privilege escalation via roles.
        Object.assign(this, userObj);
    }
}
```

- The comment admits the risk. Given the `[key: string]: unknown` index signature, `Object.assign` blindly copies every property, including `roles`, `originalEmail`, `token`, `password`, and any attacker-controlled custom fields used by `getDataFieldFilters`/`authorizedForDataRecord`.
- In `services/auth.ts:389-392` the server constructs `new AuthUser({ ...authResult, exp: ... })` straight from the verified JWT payload. That's fine *if* every JWT claim came from the server — but `buildJwtPayload` copies `jwtUserProps` from the **full user record loaded from the data store**. If any of those user-record fields are ever user-writable (e.g. a profile endpoint that accepts arbitrary JSON), an attacker can seed a custom claim like `organisationId` or something used as `userField` in a data-field rule, then enjoy bypassed data-field authorisation on subsequent requests.
- There is also no whitelist of claims accepted from a verified JWT: if someone manages to mint a token elsewhere (see H1 about key rotation/sharing), any claim they include ends up on `AuthUser` and is then consulted by `authorizedForDataRecord`.

**Recommendation:** replace `Object.assign(this, userObj)` with an explicit allowlist copy of known properties; store custom claims under a single `claims` sub-object rather than hoisted onto `this`; and reuse the same `blockedJwtUserProps` / `reservedJwtClaims` filter on *read*, not just write.

---

### H4. Cookie-based auth is accepted for cross-origin requests with `SameSite=None`
`services/auth.ts:100-111` and `services/auth.ts:368-413`

```ts
const setCookie = options?.setCookie !== false;
if (setCookie) {
    const cookieOptions = new CookieOptions({ httpOnly: true, maxAge: timeToExpirySecs });
    if (options?.strictCookie) {
        cookieOptions.sameSite = SameSiteValue.strict;
        if (isHttpsRequest(msg)) cookieOptions.secure = true;
    } else if (isHttpsRequest(msg)) {
        cookieOptions.sameSite = SameSiteValue.none;
        cookieOptions.secure = true;
    }
    msg.setCookie("rs-auth", jwt, cookieOptions);
}
```

- When the login request isn't same-domain but matches a *trusted* domain, the cookie is set with `SameSite=None` (`strictCookie` is `false`). The `setUser` handler then accepts the cookie on **every** subsequent request irrespective of the origin — there's no per-request origin check that cookie auth is only honoured from the trusted origins.
- Combined with the lack of CSRF tokens (nothing in `setUser` or in the `postPath` handlers looks for a CSRF header or double-submit token), any site a victim visits can POST to `rs-auth`-protected endpoints and the browser will attach the cookie (because `SameSite=None`).
- For plain HTTP requests (local dev, misconfigured proxy) there's no `SameSite` set at all, and no `Secure` flag, which means defaults apply and the cookie can travel over HTTP.

**Recommendations:**
1. Reject cookie-based auth on state-changing methods (POST/PUT/DELETE/PATCH) unless the request's `Origin`/`Referer` matches the runtime host or a configured trusted domain. Alternatively require a CSRF token on those methods.
2. Default to `SameSite=Lax` rather than `None`; only widen to `None` for explicit opted-in trusted domains and always force `Secure`.
3. Refuse to set any auth cookie over plain HTTP (return an error rather than silently downgrading).

---

### H5. `login` error messages enable user enumeration
`services/auth.ts:205-212`

```ts
if (!fullUser) {
    return msg.setStatus(404, 'no user record');
}
const user = new AuthUser(fullUser);
const match = await user.matchPassword(userSpec.password);
if (!match) {
    return msg.setStatus(400, 'bad password');
}
```

- Returning a different status/body for "unknown user" vs. "wrong password" lets an attacker enumerate valid accounts.
- `bcrypt.compare` is only reached when the user exists, creating a timing oracle in addition to the message/status oracle.
- There's no rate limiting, account lockout, or audit logging visible here, so enumeration and online guessing are effectively unthrottled.

**Recommendation:** respond with a single generic `401 Invalid credentials` for both cases; perform a dummy bcrypt compare when the user is missing to equalise timing; and add rate-limiting/lockout.

---

### H6. No replay/CSRF protection on MFA flow; code is posted in body without server-side attempt counting visible here
`services/auth.ts:296-339`

```ts
service.postPath("mfa/totp", async (msg, context, config) => {
    if (!isAllowedLoginDomain(msg, config)) {
        return msg.setStatus(403, "Login origin not allowed");
    }
    const cookieName = getMfaCookieName(config);
    const mfaCookie = msg.getCookie(cookieName) || "";
    const authHeader = msg.getHeader("authorization") || "";
    if (!mfaCookie && !authHeader) {
        return msg.setStatus(401, "Missing mfa cookie");
    }
    const authResult = await runtimeConfig.authoriser.verifyJwtHeader(authHeader, mfaCookie, msg.url.path);
```

- `verifyJwtHeader` uses the **same HMAC key** for every JWT in the system. The MFA challenge JWT (`mfaPending: true`) and the final session JWT (`mfaPending` absent) are both HS512-signed with the same key. Any code path that issues JWTs (e.g. impersonation, refresh, `getJwtForPayload` called from elsewhere) could in principle mint a token with `mfaPending: true` that passes this check — and vice versa, a stolen `mfaPending` token alone gets the user to the TOTP step.
- The check `(authResult as any).mfaPending !== true` is important — but the positive check on the session cookie has no corresponding `mfaPending !== true` check anywhere I can see in `setUser`, so a token with `mfaPending: true` would still authenticate the bearer as that user on normal routes. That means the MFA gate is bypassable: skip `/mfa/totp` entirely and just use the `rs-mfa` cookie / returned `_jwt` directly as `Authorization: Bearer …`.
- The TOTP code comes from the body (`{ code }`) — fine — but there is no bind between the mfa JWT and the device/browser; a leaked `rs-mfa` token can be completed from another machine.
- No rate limiting on `/mfa/totp` is visible; the totpServiceUrl backend `/mfa/verify` is expected to handle it but that's not enforced here.

**Recommendations:**
- Use a separate signing key (or at minimum an audience claim `aud: "mfa-challenge"`) for MFA tokens and reject those in `setUser` unless they bear `aud: "session"`.
- Ensure `setUser` explicitly refuses any JWT where `mfaPending === true` (it currently doesn't check).
- Bind the MFA token to the client IP/User-Agent hash at issue time and verify on completion.

---

## Medium severity

### M1. `verifyJwtHeader` silently treats anonymous paths as authenticated anon without validating other inputs
`auth/Authoriser.ts:112-117`

```ts
async verifyJwtHeader(authHeader: string, authCookie: string, path: string): Promise<IJwtPayload | string> {
    const isAnonPath = this.anonPathRoots.some((root) =>
        path === root || path.startsWith(root + '/'));
    if (isAnonPath) {
        return 'anon';
    }
```

- Anonymous path detection runs before signature verification. If a route is anon-listed, a malicious/expired JWT is **not even looked at**. This is usually intentional, but combined with the `setUser` logic (`if (!authCookie) return msg`) it means a user with an *expired* cookie hitting an anon path silently keeps an expired cookie that will then be used on subsequent non-anon requests.
- More importantly: a caller can bypass JWT verification entirely by routing the request through an anon path if the server does internal request forwarding that preserves the auth context.
- The path comparison uses startsWith with `+ '/'` — fine — but it does **no normalisation** (e.g. `..`, `%2F`, case). If `path` comes from `msg.url.path` without canonicalisation, a crafted path `/public/../admin` would not be matched as anon (good) but a path like `/Public/foo` might be treated as non-anon while the server routes it case-insensitively to `/public/foo`. Confirm that `msg.url.path` is already canonicalised.

**Recommendation:** normalise `path` (decode, collapse `..`, lowercase on case-insensitive filesystems, strip trailing slash) before the anon-root comparison, and consider always verifying JWT signature even on anon paths so that expired cookies are cleared.

---

### M2. `authorizedFor` role spec parser has subtle issues
`auth/AuthUser.ts:70-94`

- It splits on a single space and trusts that path elements in the spec won't contain spaces. Embedded spaces or tabs in a role spec give unpredictable results.
- Path matching requires that every `specPathElement` equal the corresponding `servicePathElement`, but does *not* check that the service path is not *shorter* than the spec path in a way that allows a bypass — actually `specPathElements.length > idx` is on the service side. Re-read carefully: `specPathElements.every((spe, idx) => servicePathElements.length > idx && servicePathElements[idx] === spe)`. So service path must be at least as long as spec path and match element-by-element — that's reasonable.
- `authorizedForInner` treats the literal token `'all'` specially: any role spec containing `all` grants access unconditionally. A misconfiguration or typo anywhere in a config (e.g. intending `"call"` tokenised wrong) wouldn't trigger this, but the special role is fragile and undocumented.
- Curly-brace path roles (`{email}`) compare via `pathEls.includes(...)`. This is broad: if any user field value happens to occur anywhere in the path (including query-free segments of parent paths), it grants access. E.g. a user with `name: "public"` could be authorised for `/public/anything` via `{name}` — probably not the intent.

**Recommendation:** tighten the parser to require a structured spec object (not a space-delimited string), or at least document the grammar and add unit tests for pathological cases; replace `pathEls.includes` with an exact segment position match if the intent is "match this segment", and escape/normalise user field values.

---

### M3. `isSafeDataFieldValue` accepts any number/string/boolean — including empty strings and `0`
`auth/AuthUser.ts:138-142`

```ts
private isSafeDataFieldValue(value: unknown): value is string | number | boolean {
    if (value === null || value === undefined) return false;
    const valueType = typeof value;
    return valueType === 'string' || valueType === 'number' || valueType === 'boolean';
}
```

- Returns `true` for empty string `""`. Combined with `authorizedForDataRecord`'s `String(userVal) === String(dataVal)` check, a user with `organisationId === ""` would be granted access to any record whose `organisationId` is also `""` or missing-but-stored-as-empty. Records without the field would fail (because `dataVal` would be `undefined`, which the check catches) — but the empty-string equivalence class is still a footgun.
- Returns `true` for `NaN` (typeof 'number'), but `String(NaN) === String(NaN)` is `true`, creating unintended matches.

**Recommendation:** reject empty strings and non-finite numbers explicitly.

### M4. JWT refresh blindly re-signs claims from the `AuthUser`, which includes properties never filtered
`services/auth.ts:395-408`

```ts
const refreshTime = (msg.user.exp || 0) - (sessionTimeoutMins || 30) * 60 * 1000 / 2;
const nowTime = new Date().getTime();
if (nowTime > refreshTime) {
    const refreshUser = msg.user as AuthUser;
    const payload = buildJwtPayload(refreshUser, refreshUser as unknown as Record<string, unknown>, serviceConfig.jwtUserProps);
```

- `buildJwtPayload` filters against `blockedJwtUserProps` and `reservedJwtClaims` when adding *configured* props, but it always unconditionally adds whatever is on `refreshUser.roles`. Because the refresh takes the previous JWT's roles as-is, any administrative demotion or role change on the user record won't propagate until the user logs out — sliding sessions silently prolong stale role grants indefinitely.
- Worse, because roles are copied verbatim from the JWT into the new JWT, a temporarily elevated role (impersonation) is perpetuated by every refresh until explicit logout.

**Recommendation:** on refresh, re-load the user from the data store (as `getPath('user')` already does) and re-compute the payload from authoritative data rather than from the previous JWT.

### M5. `generateToken` uses `crypto.randomUUID()` for password-reset style tokens
`auth/AuthUser.ts:189-195` and `auth/Authoriser.ts:56-58`

```ts
generateToken(): string {
    return crypto.randomUUID();
}
```

- UUIDv4 has 122 bits of entropy — acceptable but somewhat below the typical 128-bit random token recommendation, and notably it's a format that's sometimes stored in URL-loggable places (query strings, logs).
- `verifyToken` compares against `user.token` stored on the user record. There's no indication that the token is hashed at rest; if so, a DB read grants an attacker the ability to log in as that user during the validity window.
- `verifyToken` returns `TokenVerification.used` when `user.tokenExpiry` is missing, and does not clear the token after successful use — the enum value `used` is returned but no code here enforces single-use semantics.

**Recommendation:** store only a hash of the one-time token (e.g. SHA-256), rotate/clear on use, require ≥128 bits entropy, and enforce single-use at the storage layer.

---

## Low severity / hardening

### L1. `timingSafeCompare` short-circuits length in a way that still leaks length
`auth/Authoriser.ts:26-33`
The early `result = a.length ^ b.length` means the loop runs for `min(len)` iterations — the function returns quickly (effectively in constant time *for equal-length inputs*). But length itself leaks via timing because the loop iteration count depends on the shorter length. For randomly-generated tokens the attacker already knows the length, so this is largely academic — just note it. Using `crypto.subtle`'s timing-safe helpers (or comparing against a fixed-length digest) is cleaner.

### L2. `isHttpsRequest` trusts `x-forwarded-proto` unconditionally
`services/auth.ts:76-81`
Only safe behind a trusted proxy that strips this header from untrusted inputs. If the runtime is ever directly exposed to the internet, a client can send `x-forwarded-proto: https` and trick the server into setting `Secure` cookies over plain HTTP (which browsers will then refuse, but still — it masks a misconfiguration). Document the proxy requirement and/or gate this on `runtimeConfig.server?.behindTrustedProxy`.

### L3. `logger.error('jwt verify error: ' + err)` may log token content
`auth/Authoriser.ts:134-137`
If the error from `jose` includes the token or parts of it in its message, the token is written to logs. Log only the error class/message and the claim `kid` (once implemented), never the raw JWT.

### L4. `getHostnameFromHostHeader` splits on `,` but `isSameDomainBrowserRequest` trusts `x-forwarded-host`
`auth/browserOrigin.ts:17-83`
`x-forwarded-host` is trusted before `host`. Same caveat as L2 — only safe behind a trusted proxy. An attacker sending `x-forwarded-host: attacker.com` could trick `isSameDomainBrowserRequest` into claiming the request is same-domain when it isn't (especially relevant for setting the strict cookie in `getLoginCookiePolicy`).

### L5. No explicit `iat`/`nbf` claims on issued JWTs
`auth/Authoriser.ts:93-98`
Only `exp` is set. `iat` (issued-at) is useful for post-hoc revocation ("invalidate all tokens issued before T"). Consider adding `iat` and optionally `jti` for revocation lists.

### L6. `AuthUser` exposes both `password` and `token` as regular (non-private) fields, and `redactUserForClient` doesn't redact `token`/`tokenExpiry`
`services/auth.ts:159-174`

```ts
function redactUserForClient(user: any) {
    if (!user || typeof user !== "object") return user;
    const out = { ...user };
    if (out.totp && typeof out.totp === "object") { /* ... */ }
    delete out.secretEnc;
    return out;
}
```

This function deletes `secretEnc` and trims `totp` — but the `getPath('user')` handler explicitly masks `password`, and `token`/`tokenExpiry` are never removed. If a password-reset token is live on the user record, any call to `GET /auth/user` leaks it to the authenticated client (which may be acceptable if the client *is* that user, but note that bearers of another impersonated JWT could then retrieve the target's reset token).

**Recommendation:** add `token`, `tokenExpiry`, and any other sensitive fields to the redaction set, and make the allowlist explicit (return only known safe fields) rather than blacklist-based.

### L7. MFA cookie name collision check is case-sensitive
`services/auth.ts:149-157`
`if (configured === "rs-auth")` — but cookie names are matched case-insensitively by some servers and tooling. `Rs-Auth` would slip past this check. Lowercase-compare both sides.

### L8. `userRequiresTotp` accepts two different flag shapes
`services/auth.ts:176-181`
Accepting both `mfaEnabled` and `totp.enabled` increases the surface for a "fail-open" bug if one path of user updates forgets to set one flag. Pick one canonical source.

### L9. Cookie deletion on logout does not clear the MFA cookie
`services/auth.ts:249-252`
`logout` only deletes `rs-auth`. A pending `rs-mfa` cookie (maybe left over from a partial login) survives across logout.

### L10. `login` accepts `userSpec.email` and `userSpec.password` without type checks
`services/auth.ts:203-212`
If a client sends `{ email: { $ne: null } }` (classic NoSQL injection shape) and `getUserFromEmail` passes that through to a Mongo-style adapter, it could bypass the lookup. Verify that `getUserFromEmail` coerces to string, or coerce here.

---

## Things that are done well

- `buildJwtPayload` has explicit allow/deny lists (`blockedJwtUserProps`, `reservedJwtClaims`) and a type guard for claim values — good defence in depth.
- `bcrypt` is used for password storage, with async calls that don't leak via callback shape.
- `httpOnly` is set on auth cookies, and `Secure`/`SameSite=Strict` is set where appropriate.
- JWT verification fixes the algorithm list (`algorithms: ["HS512"]`) — blocks algorithm-confusion attacks.
- `AuthUser.anon` is `Object.freeze`'d, preventing accidental mutation of the shared anon sentinel.
- `authorizedForDataRecord` fails closed on missing/non-scalar fields.
- There's a constant-time password/token comparison helper.
- OPTIONS requests are explicitly excluded from authentication to prevent errors from being masked as CORS failures.
- `getMfaCookieName` rejects the name `rs-auth` to avoid cookie collisions (though see L7).

---

## Summary of the most urgent items to fix

1. **H1** — Load the JWT signing key from configuration and support rotation; current per-process random key breaks any multi-instance deployment and all restarts invalidate sessions.
2. **H3** — Replace `Object.assign(this, userObj)` in `AuthUser` with an explicit allowlist; current comment is the only safety net against privilege escalation via data-field rules.
3. **H6** — Ensure `setUser` rejects JWTs with `mfaPending: true` (and ideally use a separate audience/key for MFA challenge tokens). The current MFA gate appears bypassable.
4. **H2** — Tighten redirect validation to prevent protocol-relative/backslash/javascript: open redirects.
5. **H4** — Require origin validation or CSRF tokens for state-changing requests when cookie auth is in use with `SameSite=None`.
6. **H5** — Unify login error responses and add rate limiting / lockout to prevent user enumeration and online guessing.
