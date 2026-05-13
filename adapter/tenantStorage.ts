export interface TenantStorageNameOptions {
  lowerCase?: boolean;
  maxLength?: number;
}

const PREFIX_MAX_LENGTH = 48;
const DEFAULT_NAME_MAX_LENGTH = 120;

function safeStorageSegment(value: string, lowerCase = false): string {
  let safe = value.replace(/[^A-Za-z0-9_-]/g, "_");
  if (lowerCase) safe = safe.toLowerCase();
  safe = safe.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe) safe = "tenant";

  const startsWithSafeChar = lowerCase
    ? /^[a-z0-9]/.test(safe)
    : /^[A-Za-z0-9]/.test(safe);
  if (!startsWithSafeChar) safe = `t_${safe}`;

  return safe.slice(0, PREFIX_MAX_LENGTH);
}

export function tenantStoragePrefix(
  tenant: string,
  options: Pick<TenantStorageNameOptions, "lowerCase"> = {},
): string {
  return safeStorageSegment(tenant, options.lowerCase === true);
}

export function tenantPathSegment(tenant: string): string {
  return tenantStoragePrefix(tenant);
}

export function prefixStorageName(
  tenant: string,
  logicalName: string,
  options: TenantStorageNameOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_NAME_MAX_LENGTH;
  const prefix = tenantStoragePrefix(tenant, options);
  const separator = "__";
  const normalizedName = options.lowerCase
    ? logicalName.toLowerCase()
    : logicalName;
  const nameMaxLength = Math.max(
    1,
    maxLength - prefix.length - separator.length,
  );
  return `${prefix}${separator}${normalizedName.slice(0, nameMaxLength)}`;
}

export function unprefixStorageName(
  tenant: string,
  physicalName: string,
  options: Pick<TenantStorageNameOptions, "lowerCase"> = {},
): string | null {
  const prefix = `${tenantStoragePrefix(tenant, options)}__`;
  return physicalName.startsWith(prefix)
    ? physicalName.slice(prefix.length)
    : null;
}
