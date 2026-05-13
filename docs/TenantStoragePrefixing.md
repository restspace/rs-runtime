# Tenant Storage Prefixing

Storage adapters isolate tenants by prefixing infrastructure-visible storage
units with a readable sanitized tenant name. API users continue to use logical,
unprefixed dataset, collection, index, and file paths.

Affected adapters:

- MongoDB data and query adapters use tenant-scoped physical database names;
  collection names stay logical inside each tenant database.
- Elasticsearch data and query adapters prefix index names, including schema
  storage.
- Local file storage writes below `<rootPath>/<tenant>/<basePath>/...`.
- S3 storage writes below `<tenant>/<rootPath>/...`.

This is a breaking storage layout change. Existing unscoped MongoDB databases,
Elasticsearch indexes, filesystem paths, and S3 object keys are not read as a
fallback. Migrate existing data to the tenant-scoped physical names before
upgrading.

Configuration should no longer include tenant names in local `rootPath` values.
S3 `tenantDirectories` is deprecated because tenant path prefixes are always
applied.

For MongoDB, if `dbName` is omitted, tenant `acme` uses physical database
`acme`. If `dbName` is `runtime`, tenant `acme` uses physical database
`acme__runtime`.
