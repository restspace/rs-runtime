import { IJwtPayload } from "./Authoriser.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.2.4/mod.ts";
import { slashTrim } from "rs-core/utility/utility.ts";
import { IAuthUser, userIsAnon } from "rs-core/user/IAuthUser.ts";
import { DataFieldFilter } from "rs-core/adapter/IDataAdapter.ts";
import { config } from "../config.ts";

export class AuthUser implements IAuthUser {
    token = '';
    tokenExpiry?: Date;
    email = '';
    originalEmail = '';
    roles = '';
    password = '';
    exp?: number;
    /** Index signature to allow custom fields for data-field authorization */
    [key: string]: unknown;

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
                .map(r => (this as Record<string, any>)[r.slice(1, -1)]?.toString())
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

    /**
     * Parse data-field authorization rules from role spec.
     * Rules have the format ${datafieldname=userfieldname}
     */
    parseDataFieldRules(roleSpec: string): Array<{ dataField: string; userField: string }> {
        return roleSpec.trim().split(' ')
            .filter(r => r.startsWith('${') && r.endsWith('}') && r.includes('='))
            .map(r => {
                const inner = r.slice(2, -1); // Remove ${ and }
                const eqIdx = inner.indexOf('=');
                return {
                    dataField: inner.slice(0, eqIdx),
                    userField: inner.slice(eqIdx + 1)
                };
            });
    }

    /**
     * Check if a role spec contains data-field rules
     */
    hasDataFieldRules(roleSpec: string): boolean {
        return this.parseDataFieldRules(roleSpec).length > 0;
    }

    /**
     * Get data-field filters for adapter-level filtering
     */
    getDataFieldFilters(roleSpec: string): DataFieldFilter[] | null {
        const rules = this.parseDataFieldRules(roleSpec);
        if (rules.length === 0) return [];

        const filters: DataFieldFilter[] = [];
        for (const rule of rules) {
            const userVal = (this as Record<string, unknown>)[rule.userField];
            if (!this.isSafeDataFieldValue(userVal)) {
                return null;
            }
            filters.push({ dataFieldName: rule.dataField, userFieldValue: userVal });
        }
        return filters;
    }

    private isSafeDataFieldValue(value: unknown): value is string | number | boolean {
        if (value === null || value === undefined) return false;
        const valueType = typeof value;
        return valueType === 'string' || valueType === 'number' || valueType === 'boolean';
    }

    /**
     * Check if user is authorized for a specific data record.
     * This checks both standard role authorization and data-field rules.
     * @param data The data record to check
     * @param roleSpec The role specification (e.g., "U A ${organisationId=organisationId}")
     * @param servicePath Optional service path for existing path-based checks
     * @returns true if authorized, false otherwise
     */
    authorizedForDataRecord(
        data: Record<string, unknown>,
        roleSpec: string,
        servicePath?: string
    ): boolean {
        // First check standard role authorization
        if (!this.authorizedFor(roleSpec, servicePath)) return false;

        // Admin bypass: if user has 'A' role and 'A' is in allowed roles, skip data-field checks
        const reqRoles = roleSpec.trim().split(' ').filter(r => !!r);
        if (this.hasRole('A') && reqRoles.includes('A')) return true;

        // Then check data-field rules (all must pass)
        const rules = this.parseDataFieldRules(roleSpec);
        if (rules.length === 0) return true;

        return rules.every(rule => {
            const userVal = (this as Record<string, unknown>)[rule.userField];
            const dataVal = data[rule.dataField];
            // Fail closed: missing fields deny access
            if (!this.isSafeDataFieldValue(userVal) || !this.isSafeDataFieldValue(dataVal)) return false;
            return String(userVal) === String(dataVal);
        });
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
