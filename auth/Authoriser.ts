import { AuthUser } from './AuthUser.ts';
import * as jwt from 'https://deno.land/x/djwt@v2.3/mod.ts';
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

    private async ensureKey() {
        if (!this.key) {
            this.key = await crypto.subtle.generateKey(
                {
                    name: "HMAC",
                    hash: "SHA-512"
                },
                true,
                [ "sign", "verify" ]
            );
        }
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

    verifyToken(token: string, user: IAuthUser): TokenVerification {
        const tokenMatch = (user.token === token);
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
        await this.ensureKey();
        return await jwt.create(
            { alg: "HS512", typ: "JWT" },
            { ...payload, exp: jwt.getNumericDate(expirySecs || (config.jwtExpiryMins * 60)) },
            this.key
        );
    }

    async getImpersonationJwt(user: AuthUser, newEmail: string, newRoles?: string) {
        await this.ensureKey();
        const impersonationJwtPayload = user.getJwtPayload();
        if (newRoles) impersonationJwtPayload.roles = newRoles;
        impersonationJwtPayload.email = newEmail;
        if (newEmail !== (user.originalEmail || user.email)) { // only have an original email if its != the email
            impersonationJwtPayload.originalEmail = user.email;
        }
        impersonationJwtPayload.exp = jwt.getNumericDate(config.jwtExpiryMins * 60);
        return await jwt.create({ alg: "HS512", typ: "JWT" }, { ...impersonationJwtPayload }, this.key);
    }

    async verifyJwtHeader(authHeader: string, authCookie: string, path: string): Promise<IJwtPayload | string> {
        const isAnonPath = (this.anonPathRoots.filter((root) => path.startsWith(root)).length > 0);
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
        await this.ensureKey();
        let payload: IJwtPayload;
        try {
            payload = (await jwt.verify(jwToken, this.key)) as unknown as IJwtPayload;
        } catch (err) {
            config.logger.error('jwt verify error: ' + err);
            return '';
        }
        return payload;
    }
}