# Key-signing service with local and AWS KMS adapters
## Problem
JWT HMAC signing in `auth/Authoriser.ts` uses an ephemeral per-process, non-extractable `CryptoKey`. This breaks horizontal scaling (each instance signs with a different key), invalidates all sessions on restart, and offers no key rotation. We need to abstract signing behind a Restspace adapter so the default deployment gets a shared-key local implementation and production deployments can move signing out of process to AWS KMS (or any other adapter) without changes at call sites.
## Current state (only what's relevant)
* `config.authoriser` is the single runtime `Authoriser` instance (`config.ts:103`). All JWT issue/verify flows hang off it.
* JWT call sites: `services/auth.ts` (login, mfa/totp, setUser refresh), `auth/Authoriser.ts` (`getImpersonationJwt`), plus non-JWT token gen/verify used by `services/account.ts` (password reset / email confirm) and `auth/AuthUser.ts:189-200`.
* Restspace already has the idioms we need: services + `.rsm.js` manifests, adapters + `.ram.js` manifests, both registered in `Modules.ts`. The `IServerConfig.infra` map (`config.ts:13-26`) names infra entries keyed to adapter sources. `getStateDataAdapter.ts` shows how framework-internal code resolves an adapter-backed store.
* AWS service adapters already compose via `AWS4ProxyAdapter` for SigV4 (`adapter/SnsSmsAdapter.ts:18-29`). A KMS adapter can use the same pattern.
* TOTP shows the envelope-encryption idiom in-repo (`auth/totp.ts:160-187`): AES-GCM via an env-supplied master key.
* AWS KMS offers two shapes that are both suitable: `GenerateMac`/`VerifyMac` with HMAC KMS keys (drop-in for HS512) and `Sign`/`Verify` with asymmetric keys (better long-term because verification can use the public key). We'll support both via the same adapter with a `keySpec` discriminator.
## Proposed changes
### 1. New `ISignerAdapter` interface (`rs-core/adapter/ISignerAdapter.ts`)
Defines `sign`, `verify`, optional `listKeys`, `rotate`, `retire`. Crucially it exposes no method to retrieve key material. `sign` takes `(payload, { expirySecs, audience? })` and returns `{ token, kid, alg, expiresAt }`; the adapter owns `exp`/`iat`/`kid` claims. `verify` takes a token and returns `{ payload, kid, alg }` or throws a typed error (`BadSignature`, `Expired`, `UnknownKid`, `AdapterUnavailable`).
### 2. Refactor `Authoriser` into a thin façade
* Retain `registerAnonPathRoots`, `generateToken` (random UUID for password-reset-style tokens — not JWT), `verifyToken` (compares against `user.token`).
* Rewrite `getJwt`, `getJwtForPayload`, `getImpersonationJwt` to delegate to `config.signer.sign(...)`.
* Rewrite `verifyJwtHeader` to resolve `kid` from the JWT protected header and call `config.signer.verify(...)`. Narrow algorithm allow-list remains.
* Drop internal `ensureKey`/`signJwtPayload`. Replace `config.logger.error('jwt verify error: ' + err)` with a typed-error-only log (kid + class name, never the token).
* Add `iat` claim to issued JWTs alongside `exp` to enable future "invalidate tokens issued before T" semantics.
### 3. Wire `config.signer` (`config.ts`)
* Add `signer: ISignerAdapter` to the `config` object, populated during tenant bootstrap from a new `signer` infra entry, with fallback to a default `LocalSignerAdapter` bound to `stateStore` when none configured. This keeps the dev "just run it" experience.
* Add optional `keyStore?: string` to `IServerConfig.infra` so operators can point key storage at a different backend than `stateStore` if they want isolation.
### 4. `LocalSignerAdapter` (`adapter/LocalSignerAdapter.ts` + `.ram.js`)
Implements `ISignerAdapter` using an `IDataAdapter` for persistence (resolved via `config.modules.getAdapter`, mirroring `getStateDataAdapter`). Config schema:
* `keyStoreInfra?: string` — infra name (defaults to `stateStore`).
* `basePath: string` — default `/_keys/rs-auth`.
* `kekEnvVar?: string` — default `RS_KEY_WRAP_KEK`; base64-encoded 32-byte key.
* `kekFilePath?: string` — alternative to env.
* `algorithm: "HS512"` initially; later `"EdDSA"` / `"RS256"`.
* `overlapMins: number` — default 2×`jwtExpiryMins`; retired keys remain valid for verify until expired tokens have aged out.
* `ephemeralFallback: boolean` — default `false`; when `true` and no KEK configured, generate an in-memory DEK with a prominent warning (preserves today's behaviour for local dev only).
Behaviour:
* Key record: `{ kid, alg, createdAt, notAfter?, notValidFor?, wrapAlg: "AES-256-GCM", iv, wrapped }` stored one-per-record under `basePath`.
* KEK loaded once at boot via `config.getParam` (env) or `Deno.readFile` (keyfile), imported as a non-extractable AES-GCM `CryptoKey`. Raw bytes are discarded after import.
* DEK cache: `Map<kid, CryptoKey>` built from records read through the adapter, refreshed on demand and on a configurable interval (default 5 min) so instances converge on rotation.
* `sign`: picks the active `signingKid`, builds the compact JWS via `jose.SignJWT` with `kid` in the protected header.
* `verify`: uses `jose.jwtVerify` with a `getKey(header)` callback that pulls the `CryptoKey` out of the cache; rejects unknown/retired kids.
* `rotate`: generates a new 64-byte HMAC key, wraps with KEK, writes the record, sets it as the new `signingKid`, marks the previous as `notAfter=now`, `notValidFor=now+overlapMins`.
* `retire(kid)`: sets `notAfter=now` only; does not delete until `notValidFor` passes.
* Concurrency: use an optimistic write with a per-record etag (or adapter-specific equivalent) so two instances racing a rotation converge on one winner rather than two kids claiming primary.
### 5. `KmsSignerAdapter` (`adapter/KmsSignerAdapter.ts` + `.ram.js`)
Implements `ISignerAdapter` by delegating to AWS KMS through the existing `AWS4ProxyAdapter` (no new AWS dependency). Config schema mirrors `SnsSmsAdapter` for credentials: `region`, `accessKeyId?`, `secretAccessKey?`, `ec2IamRole?`, plus:
* `keySpec: "HMAC" | "ASYMMETRIC"`.
* `kmsKeyId: string` — primary signing key (alias ARN recommended).
* `additionalVerifyKeyIds?: string[]` — prior keys still accepted for verify.
* `signingAlgorithm: "HMAC_SHA_512" | "RSASSA_PSS_SHA_512" | "ECDSA_SHA_512" | "ED25519_SHA_512"` and a matching JWT `alg` (`HS512`, `PS512`, `ES512`, `EdDSA`).
* `publicKeyCacheMins?: number` — default 60, for asymmetric verify without a KMS round trip.
Behaviour:
* `sign`: builds the JWS header+payload, base64url-encodes the signing input, calls `kms:GenerateMac` (HMAC keyspec) or `kms:Sign` with `MessageType=RAW` (asymmetric). Assembles the compact JWS with the returned `Mac`/`Signature`. `kid` is the KMS key ID (or a stable alias).
* `verify` (HMAC): calls `kms:VerifyMac`. Accepts `additionalVerifyKeyIds` by iterating those on `kid` mismatch. Network error → `AdapterUnavailable` (retry with small exponential backoff, small circuit breaker).
* `verify` (asymmetric): pulls public key via `kms:GetPublicKey`, caches it per `kid`, then verifies locally with `jose.importSPKI` + `jose.jwtVerify`. No KMS round-trip on hot path.
* `rotate`/`retire`: surface KMS key rotation via the admin endpoints only as informational operations that promote/demote `kmsKeyId`/`additionalVerifyKeyIds` in adapter config (the actual KMS key lifecycle is a platform operation). Optional convenience: call `kms:CreateKey` if explicitly configured to do so.
* Message-size guard: KMS limits `Message` to 4096 bytes. JWT signing inputs are far smaller, but refuse >4096 defensively.
* Observability: log KMS call latency and error class (never the token), mirror existing AWS adapter logging.
### 6. `keyring` service (`services/keyring.ts` + `.rsm.js`)
Thin admin surface delegating to whichever `ISignerAdapter` is active. All endpoints require role `A`.
* `GET /keys` → metadata only (kid, alg, createdAt, notAfter, notValidFor, active flag). Never wrapped material.
* `POST /rotate` → invokes `adapter.rotate()`, returns new kid.
* `POST /retire/{kid}` → `adapter.retire(kid)`.
* `GET /public-key/{kid}` (asymmetric only) → PEM/JWK for external verifiers.
* `GET /jwks` (asymmetric only) → standard JWKS document, enables third-party relying parties.
The service config lets tenants pick an adapter by name; adapter loading uses the same `getAdapter` flow as other services. Service refuses to expose `rotate`/`retire` if the adapter lacks them (KMS keyspec may).
### 7. Call-site adaptation
* `services/auth.ts`: `setJwt`/`setMfaJwt` continue to call `runtimeConfig.authoriser.getJwtForPayload` (unchanged shape). `setUser` already uses `runtimeConfig.authoriser.verifyJwtHeader` — unchanged.
* MFA hardening landed as part of this plan: `setUser` explicitly rejects payloads with `mfaPending === true` so an MFA challenge token cannot be presented on normal routes. Also add `aud: "mfa-challenge"` to MFA tokens and `aud: "session"` to session tokens, enforced in `verify` via `opts.audience`.
* `services/account.ts` and `auth/AuthUser.ts` keep using `generateToken`/`verifyToken` — these remain in `Authoriser` and are unrelated to signing.
* `getImpersonationJwt` goes through the same `sign` path, picking up `kid` automatically.
### 8. Registration & manifests
* Register new adapters and service in `Modules.ts`:
    * `./adapter/LocalSignerAdapter.ts` + `LocalSignerAdapter.ram.js` (adapterInterfaces: `["ISignerAdapter"]`).
    * `./adapter/KmsSignerAdapter.ts` + `KmsSignerAdapter.ram.js` (same).
    * `./services/keyring.ts` + `keyring.rsm.js` (adapterInterface: `"ISignerAdapter"`).
* Add `signer` (optional) infra entry to `IServerConfig` and document in config schema.
### 9. Migration strategy
* Phase 1 (one release): Ship `LocalSignerAdapter` as the default, populated transparently. Tokens gain `kid` header. Without `RS_KEY_WRAP_KEK` it falls back to ephemeral in-memory DEK — **unchanged behaviour** for current deployments, with a warning log.
* Phase 2 (operator action): Operators provision `RS_KEY_WRAP_KEK`, restart. New JWTs reference a persisted kid. Old `kid`-less tokens are accepted during `overlapMins` using a legacy in-memory key; afterwards rejected.
* Phase 3 (production hardening): Operators configure `signer` infra → `KmsSignerAdapter`. Runtime starts verifying via KMS; after a transition window the local kid is retired and removed from `additionalVerifyKeyIds`.
### 10. Tests
* Unit: round-trip sign/verify for both adapters (Kms against a stubbed `AWS4ProxyAdapter` returning canned `Mac`/`Signature` blobs), rotation produces overlapping valid kids, retired kids rejected past `notValidFor`, wrong-algorithm rejection, `mfaPending` not accepted on session routes.
* Integration: extend `test/jwtUserProps.test.ts` and `test/totpAuth.challenge.test.ts` to run against `LocalSignerAdapter` with a fixed KEK; add a boot test where two simulated instances share a store and verify each other's tokens.
* Contract test: both adapters satisfy the same harness (interface conformance).
## Out of scope (noted, not done here)
* Other cloud KMS adapters (GCP KMS, Azure Key Vault, Vault Transit). Once `ISignerAdapter` lands these are additive and don't require framework changes.
* Revocation lists / `jti` tracking. The adapter contract supports it later; not needed to fix H1.
* Moving `generateToken`/`verifyToken` (the non-JWT password-reset tokens) behind the signer. They have a different threat model and can be migrated separately if desired.
