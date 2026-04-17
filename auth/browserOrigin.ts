import { Message } from "rs-core/Message.ts";

export interface BrowserOriginConfig {
    allowedLoginDomains?: string[];
    trustedDomains?: string[];
}

export function getHostnameFromUrlHeader(headerValue: string): string {
    if (!headerValue) return "";
    try {
        return new URL(headerValue).hostname.toLowerCase();
    } catch {
        return "";
    }
}

export function getHostnameFromHostHeader(hostValue: string): string {
    if (!hostValue) return "";
    const firstHost = hostValue.split(",")[0].trim();
    if (!firstHost) return "";
    try {
        return new URL(`http://${firstHost}`).hostname.toLowerCase();
    } catch {
        return firstHost.split(":")[0].toLowerCase();
    }
}

export function getRequestOriginHost(msg: Message): string {
    return (
        getHostnameFromUrlHeader(msg.getHeader("origin") || "") ||
        getHostnameFromUrlHeader(msg.getHeader("referer") || "")
    );
}

function normalizeAllowedDomainEntry(entry: string): string {
    const trimmed = (entry || "").trim().toLowerCase();
    if (!trimmed) return "";
    if (!trimmed.includes("://")) {
        return getHostnameFromHostHeader(trimmed);
    }

    const directHost = getHostnameFromUrlHeader(trimmed);
    if (directHost) return directHost;

    const afterScheme = trimmed.split("://")[1] || "";
    const hostAndPort = afterScheme.split("/")[0] || "";
    const wildcardOrHost = hostAndPort.split("@").pop() || "";
    return getHostnameFromHostHeader(wildcardOrHost);
}

function hostMatchesAllowedDomain(host: string, allowedDomain: string): boolean {
    if (!host || !allowedDomain) return false;
    if (allowedDomain.startsWith("*.")) {
        const suffix = allowedDomain.slice(2);
        return host === suffix || host.endsWith(`.${suffix}`);
    }
    return host === allowedDomain;
}

export function requestOriginMatchesConfiguredDomains(msg: Message, domainEntries?: string[]): boolean {
    const configuredDomains = (domainEntries || [])
        .filter((entry) => !!(entry || "").trim())
        .map(normalizeAllowedDomainEntry)
        .filter((entry) => !!entry);
    if (configuredDomains.length === 0) return false;

    const requestOriginHost = getRequestOriginHost(msg);
    if (!requestOriginHost) return false;

    return configuredDomains.some((allowedDomain) => hostMatchesAllowedDomain(requestOriginHost, allowedDomain));
}

export function isSameDomainBrowserRequest(msg: Message): boolean {
    const requestOriginHost = getRequestOriginHost(msg);

    const runtimeHost =
        getHostnameFromHostHeader(msg.getHeader("x-forwarded-host") || "") ||
        getHostnameFromHostHeader(msg.getHeader("host") || "") ||
        getHostnameFromHostHeader(msg.url.domain || "");

    if (!requestOriginHost || !runtimeHost) return false;
    return requestOriginHost === runtimeHost;
}

export function isAllowedLoginDomain(msg: Message, config: BrowserOriginConfig): boolean {
    if (isSameDomainBrowserRequest(msg)) return true;

    const hasAllowedDomainEntries = (config.allowedLoginDomains || []).some((entry) => !!(entry || "").trim());
    if (!hasAllowedDomainEntries) return true;

    return requestOriginMatchesConfiguredDomains(msg, config.allowedLoginDomains);
}

export function isTrustedLoginDomain(msg: Message, config: BrowserOriginConfig): boolean {
    return requestOriginMatchesConfiguredDomains(msg, config.trustedDomains);
}

export function isCookieAuthOriginTrusted(msg: Message, config: BrowserOriginConfig): boolean {
    return isSameDomainBrowserRequest(msg) || isTrustedLoginDomain(msg, config);
}
