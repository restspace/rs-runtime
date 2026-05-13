# Tenant Storage Prefixing

Storage adapters isolate tenants by prefixing infrastructure-visible storage
units with a readable sanitized tenant name. API users continue to use logical,
unprefixed dataset, collection, index, and file paths.

Affected adapters:

- MongoDB data and query adapters use tenant-scoped physical database names;
  collection names stay logical inside each tenant database.
- Elasticsearch data and query adapters prefix index names by default, including
  schema storage.
- Local file storage writes below `<rootPath>/<tenant>/<basePath>/...`.
- S3 storage writes below `<rootPath>/<tenant>/...` by default.

This is a breaking storage layout change. Existing unscoped MongoDB databases,
Elasticsearch indexes, filesystem paths, and S3 object keys are not read as a
fallback. Migrate existing data to the tenant-scoped physical names before
upgrading.

Configuration should no longer include tenant names in local `rootPath` values.
S3 `tenantDirectories` is an infra-only option which defaults to `true`. Set it
to `false` only when the S3 bucket or `rootPath` is already tenant-specific.
Elasticsearch `tenantIndexes` is also infra-only and defaults to `true`. Set it
to `false` only for deliberately shared Elasticsearch indexes, and only with a
non-empty `allowedTenants` list on the infra. In that shared mode, allowed
tenants address the same physical indexes and can collide with each other.

For MongoDB, if `dbName` is omitted, tenant `acme` uses physical database
`acme`. If `dbName` is `runtime`, tenant `acme` uses physical database
`acme__runtime`.
