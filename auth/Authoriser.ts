import { AuthUser } from './AuthUser.ts';
import { jwtVerify, SignJWT, type JWTPayload } from "jsr:@panva/jose@6.2.2";
import { config } from "../config.ts";
import { IAuthUser } from "rs-core/user/IAuthUser.ts";

export enum TokenVerification {
    noMatch = 'noMatch',
    expired = 'expired',
    ok = 'ok',
    used = 'used'
}

export interface IJwtPayload {
    email: string;
    exp?: number;
    roles: string;
    originalEmail?: string;
    [key: string]: unknown;
}

export class Authoriser {
    protected key: CryptoKey | null = null;

    protected anonPathRoots: string[] = [];

    private timingSafeCompare(a: string, b: string): boolean {
        // Constant-time string comparison to prevent timing attacks
        let result = a.length ^ b.length;
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }

    private async ensureKey() {
        if (!this.key) {
            this.key = await crypto.subtle.generateKey(
                {
                    name: "HMAC",
                    hash: "SHA-512"
                },
                false,
                [ "sign", "verify" ]
            );
        }
        return this.key;
    }

    registerAnonPathRoots(pathRoots: string[]) {
        if (this.anonPathRoots.length > 0) {
            throw new Error('Cant specify anonymous auth path roots more than once');
        }
        this.anonPathRoots = pathRoots;
    }

    generateToken(): string {
        return crypto.randomUUID();
    }

    private getNumericDate(secondsFromNow: number) {
        return Math.floor(Date.now() / 1000) + secondsFromNow;
    }

    private async signJwtPayload(payload: Record<string, unknown>) {
        const key = await this.ensureKey();
        return await new SignJWT(payload as JWTPayload)
            .setProtectedHeader({ alg: "HS512", typ: "JWT" })
            .sign(key);
    }

    verifyToken(token: string, user: IAuthUser): TokenVerification {
        const tokenMatch = this.timingSafeCompare(user.token || '', token);
        if (!tokenMatch) return TokenVerification.noMatch;
        let notExpired = false;
        if (user.tokenExpiry) {
            const tokenExpiryDate = new Date(user.tokenExpiry);
            notExpired = tokenExpiryDate.getTime() > new Date().getTime();
        } else {
            return TokenVerification.used;
        }
    
        if (tokenMatch && notExpired) {
            return TokenVerification.ok;
        } else {
            return TokenVerification.expired;
        }
    }

    async getJwt(user: AuthUser, expirySecs?: number) {
        return await this.getJwtForPayload(user.getJwtPayload() as unknown as Record<string, unknown>, expirySecs);
    }

    async getJwtForPayload(payload: Record<string, unknown>, expirySecs?: number) {
        return await this.signJwtPayload({
            ...payload,
            exp: this.getNumericDate(expirySecs || (config.jwtExpiryMins * 60))
        });
    }

    async getImpersonationJwt(user: AuthUser, newEmail: string, newRoles?: string) {
        await this.ensureKey();
        const impersonationJwtPayload = user.getJwtPayload();
        if (newRoles) impersonationJwtPayload.roles = newRoles;
        impersonationJwtPayload.email = newEmail;
        if (newEmail !== (user.originalEmail || user.email)) { // only have an original email if its != the email
            impersonationJwtPayload.originalEmail = user.email;
        }
        impersonationJwtPayload.exp = this.getNumericDate(config.jwtExpiryMins * 60);
        return await this.signJwtPayload({ ...impersonationJwtPayload });
    }

    async verifyJwtHeader(authHeader: string, authCookie: string, path: string): Promise<IJwtPayload | string> {
        const isAnonPath = this.anonPathRoots.some((root) =>
            path === root || path.startsWith(root + '/'));
        if (isAnonPath) {
            return 'anon';
        }
        let jwToken = '';
        if (authHeader) {
            const hdrParts = authHeader.split(' ');
            if (hdrParts.length < 2)
                return '';
            jwToken = hdrParts[1];
        } else if (authCookie) {
            jwToken = authCookie;
        } else {
            return '';
        }
        const key = await this.ensureKey();
        let payload: IJwtPayload;
        try {
            const verifiedJwt = await jwtVerify(jwToken, key, { algorithms: [ "HS512" ] });
            payload = verifiedJwt.payload as IJwtPayload;
        } catch (err) {
            config.logger.error('jwt verify error: ' + err);
            return '';
        }
        return payload;
    }
}
