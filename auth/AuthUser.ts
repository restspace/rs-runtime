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

    get rolesArray() {
        return this.roles.split(' ').filter(r => !!r).map(r => r.trim());
    }

    constructor(userObj: Partial<IAuthUser>) {
        userObj && Object.assign(this, userObj);
    }

    getJwtPayload(): IJwtPayload {
        return { email: this.email, roles: this.roles };
    }

    hasRole(role: string) {
        return this.rolesArray.indexOf(role) >= 0;
    }

    addRole(role: string) {
        if (!this.rolesArray.includes(role)) {
            this.roles += (this.roles ? " " : "") + role;
        }
        return this;
    }

    private authorizedForInner(reqRoles: string[], path?: string) {
        if (reqRoles.includes('all')) return true;

        if (!this.roles) return false;
        let userRoles = this.rolesArray;
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
        const servicePathElements = servicePath ? servicePath.split('/').filter(el => !!el) : null;
        let specParts = roleSpec.trim().split(' ');
        let specPathElements = [] as string[];
        let rootReqRoles = [] as string[];
        while (specParts.length) {
            const nextUrlIdx = specParts.findIndex(s => s.startsWith('/'));
            const reqRoles = nextUrlIdx < 0 ? specParts : specParts.slice(0, nextUrlIdx);
            if (specPathElements.length === 0) {
                rootReqRoles = reqRoles;
            } else if (servicePathElements
                && specPathElements.every((spe, idx) =>
                    servicePathElements.length > idx && servicePathElements[idx] === spe)) {
                return this.authorizedForInner(reqRoles, servicePath);
            }
            
            if (reqRoles.length < specParts.length) {
                specPathElements = specParts[reqRoles.length].split('/').filter(el => !!el);
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