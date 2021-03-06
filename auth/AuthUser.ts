import { IJwtPayload } from "./Authoriser.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.2.4/mod.ts";
import { slashTrim } from "rs-core/utility/utility.ts";
import { IAuthUser, userIsAnon } from "rs-core/user/IAuthUser.ts";
import { config } from "../config.ts";

export class AuthUser implements IAuthUser {
    token = '';
    tokenExpiry?: Date;
    email = '';
    originalEmail = '';
    roles = '';
    password = '';
    exp?: number;

    constructor(userObj: Partial<IAuthUser>) {
        userObj && Object.assign(this, userObj);
    }

    getJwtPayload(): IJwtPayload {
        return { email: this.email, roles: this.roles };
    }

    hasRole(role: string) {
        return this.roles && this.roles.split(' ').indexOf(role) >= 0;
    }

    private authorizedForInner(reqRoles: string[], path?: string) {
        if (reqRoles.indexOf('all') >= 0) return true;

        if (!this.roles) return false;
        let userRoles = this.roles.trim().split(' ');
        let authorized = reqRoles.some(reqRole => userRoles.includes(reqRole));

        if (path) {
            // e.g. {email} will succeed if the user's email is part of the request path
            // for instance this will let a user access their own record
            const pathMatches = reqRoles
                .filter(r => r.startsWith('{') && r.endsWith('}'))
                .map(r => (this as Record<string, any>)[r.slice(1, -1)].toString())
                .filter(m => !!m);
            userRoles = userRoles.filter(r => !r.startsWith('{'));
            const pathEls = slashTrim(path).split('/');
            authorized = authorized || pathMatches.some(pathMatch => pathEls.includes(pathMatch));
        }

        return authorized;
    }

    authorizedFor(roleSpec: string, servicePath?: string) {
        if (servicePath && !servicePath.startsWith('/')) servicePath = '/' + servicePath;
        let specParts = roleSpec.trim().split(' ');
        let specPath = '/';
        let rootReqRoles = [] as string[];
        while (specParts.length) {
            const nextUrlIdx = specParts.findIndex(s => s.startsWith('/'));
            const reqRoles = nextUrlIdx < 0 ? specParts : specParts.slice(0, nextUrlIdx);
            if (specPath === '/') {
                rootReqRoles = reqRoles;
            } else if (servicePath && servicePath.startsWith(specPath)) {
                return this.authorizedForInner(reqRoles, servicePath);
            }
            
            if (reqRoles.length < specParts.length) {
                specPath = specParts[reqRoles.length];
                specParts = specParts.slice(reqRoles.length + 1);
            } else {
                specParts = [];
            }
        }
        return this.authorizedForInner(rootReqRoles, servicePath);
    }

    isAnon() {
        return userIsAnon(this);
    }

    async hashPassword(): Promise<void> {
        this.password = await bcrypt.hash(this.password);
    }

    async matchPassword(pw: string): Promise<boolean> {
        return await bcrypt.compare(pw, this.password);
    }

    generateToken(expirySeconds: number) {
        const auth = config.authoriser;
        this.token = auth.generateToken();
        this.tokenExpiry = new Date();
        this.tokenExpiry.setSeconds(this.tokenExpiry.getSeconds() + expirySeconds);
        return this.token;
    }

    verifyToken(token: string) {
        const auth = config.authoriser;
        return auth.verifyToken(token, this);
    }

    passwordMask() {
        return this.password ? AuthUser.passwordMask : AuthUser.noPasswordMask;
    }

    passwordIsMaskOrEmpty() {
        return this.password === AuthUser.passwordMask
        || this.password === AuthUser.noPasswordMask
        || !this.password;
    }

    static passwordMask = '<hidden>';
    static noPasswordMask = '<no password>';
    static anon = new AuthUser({});
}