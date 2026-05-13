# Elasticsearch `tenantIndexes` Plan

## Summary

Add `tenantIndexes?: boolean` to both Elasticsearch adapters. It defaults to
`true`, preserving current tenant-prefixed index behavior. When set to `false`
on server `infra`, Elasticsearch indexes are addressed by their normalized
logical names without tenant prefixes.

`tenantIndexes` must be infra-only. Tenant `servicesConfig.json` adapter config
must not be able to set or override it.

## Behavior

- Omitted or `true`: tenant index isolation is enabled.
  - tenant `acme`, logical index `Orders` -> physical index `acme__orders`
  - no-index query wildcard -> `acme__*`
  - schema index -> `acme__.schemas`
- `false`: tenant index isolation is disabled for that infra.
  - tenant `acme`, logical index `Orders` -> physical index `orders`
  - no-index query wildcard -> `*`
  - schema index -> `.schemas`
- The exact tenant prefix syntax remains the existing safe lower-case tenant
  storage prefix plus `__`.
- This flag affects only physical Elasticsearch addressing. API users continue
  to use logical index names.

## Safety Policy

`tenantIndexes: false` deliberately allows all tenants using the same infra to
share and collide on the same Elasticsearch indexes. That is useful for a
controlled shared data set, but it removes Restspace's Elasticsearch-level
tenant isolation for those tenants.

Implementation should therefore reject an Elasticsearch infra that sets
`tenantIndexes: false` unless one of these is true:

- the infra has a non-empty `allowedTenants` list; or
- a future explicit server-side escape hatch is added for infrastructure that is
  already isolated outside Restspace.

For this implementation, use the first rule only: require non-empty
`allowedTenants` when `tenantIndexes === false`.

Example:

```json
{
  "infra": {
    "sharedElastic": {
      "adapterSource": "./adapter/ElasticDataAdapter.ram.json",
      "host": "https://elastic.example.com",
      "username": "shared-user",
      "password": "...",
      "tenantIndexes": false,
      "allowedTenants": ["acme", "beta"]
    }
  }
}
```

In this example, `acme` and `beta` both use physical index `orders` for logical
index `orders`. Other tenants cannot use this infra.

## Implementation Changes

- Add `tenantIndexes?: boolean` to the shared Elasticsearch adapter props used
  by:
  - `ElasticDataAdapter`
  - `ElasticQueryAdapter`
- Update both Elasticsearch adapter manifests:
  - add `tenantIndexes` to `configSchema.properties`;
  - add `"infraOnlyConfigProperties": [ "tenantIndexes" ]`.
- Use the existing manifest-driven infra-only enforcement in `ServiceFactory`.
  If implementing in a context without that mechanism, add it first.
- Add validation in the infra/adapter creation path:
  - when an Elasticsearch adapter infra has `tenantIndexes === false`, require
    `allowedTenants` to be a non-empty string array;
  - return a clear error if this is violated.
- In `ElasticDataAdapter`:
  - `physicalIndexName(dataset)` should prefix only when
    `tenantIndexes !== false`;
  - `logicalIndexName(index)` should unprefix when enabled, and return the
    normalized/raw physical index name when disabled;
  - `.schemas` must follow the same rule as normal indexes.
- In `ElasticQueryAdapter`:
  - `physicalIndexName(index)` should prefix only when
    `tenantIndexes !== false`;
  - default no-index query wildcard should be `<safeTenant>__*` when enabled
    and `*` when disabled.
- Update tenant storage docs to describe the default and the guarded shared
  infra mode.

## Tests

- Adapter behavior:
  - `ElasticDataAdapter.physicalIndexName("Orders")` returns `tenant__orders`
    by default;
  - with `tenantIndexes: true`, it returns `tenant__orders`;
  - with `tenantIndexes: false`, it returns `orders`;
  - `logicalIndexName` strips prefixes when enabled and returns raw index names
    when disabled.
- Query behavior:
  - explicit query index is prefixed by default;
  - explicit query index is not prefixed when `tenantIndexes: false`;
  - no-index query uses tenant wildcard by default and `*` when disabled.
- Config policy:
  - infra-level `tenantIndexes: false` with non-empty `allowedTenants` is
    accepted;
  - infra-level `tenantIndexes: false` without non-empty `allowedTenants` is
    rejected;
  - service-level `adapterConfig.tenantIndexes` is rejected as infra-only.
- Regression:
  - existing Elasticsearch configs without `tenantIndexes` continue to use
    tenant-prefixed physical indexes.

## Assumptions

- `tenantIndexes: false` is intended for explicitly shared Elasticsearch data
  between a controlled tenant group.
- `allowedTenants` controls which tenants can use the infra; it does not isolate
  those allowed tenants from each other inside Elasticsearch.
- The flag applies consistently to data indexes, schema indexes, and wildcard
  query targeting.
