# MongoDbQueryAdapter

Query adapter for running MongoDB aggregation pipelines.

## Configuration

```json
{
  "url": "mongodb://localhost:27017",
  "dbName": "myDatabase",
  "tlsCAFile": "/path/to/ca.pem",
  "ignoreEmptyVariables": true
}
```

| Property | Required | Description |
|----------|----------|-------------|
| `url` | Yes | MongoDB connection URI (`mongodb://` or `mongodb+srv://`) |
| `dbName` | Yes | Database name |
| `tlsCAFile` | No | Path to CA bundle (for DocumentDB TLS) |
| `ignoreEmptyVariables` | No | When true, empty string variables are ignored in queries |

The `url` can also reference a secret via the resolver.

## Query Format

Queries are JSON objects with the following structure:

```json
{
  "collection": "myCollection",
  "pipeline": [
    { "$match": { "status": "active" } },
    { "$group": { "_id": "$category", "count": { "$sum": 1 } } }
  ],
  "from": 0,
  "size": 25,
  "options": {}
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `collection` | Yes | Target collection name (will be normalized) |
| `pipeline` | Yes | MongoDB aggregation pipeline array |
| `from` | No | Zero-based offset for paging |
| `size` | No | Page size for paging |
| `options` | No | Additional aggregation options passed to MongoDB |

## Paging

When `from` and/or `size` are provided, the adapter appends a `$facet` stage to compute:

- `items`: the paged results (`$skip`/`$limit`)
- `total`: the total count of matching documents

When paging is provided, the adapter returns `{ "items": [...], "total": n }`. When omitted, the pipeline runs as-is and returns an array.

## Return Values

- **Success (no paging)**: Array of result documents
- **Success (paging)**: Object with `items` array and numeric `total`
- **400**: Invalid JSON or query format error
- **Other HTTP status**: Mapped from MongoDB errors

## Variable Quoting

Use the `quote()` method to safely escape values for interpolation:

```typescript
adapter.quote("hello")      // "\"hello\""
adapter.quote(123)          // "123"
adapter.quote([1, 2, 3])    // "[1,2,3]"
adapter.quote({})           // Error - objects not allowed
```

Only primitives and arrays of primitives are supported.

## Ignoring Empty Variables

The query service (`services/query.ts`) substitutes request body parameters into query templates using `${paramName}` syntax. When a parameter is missing, it defaults to an empty string. Without special handling, this would create a filter like `{ "category": "" }` which matches only documents where the field is literally empty - usually not the intended behavior.

When `ignoreEmptyVariables: true` is configured, missing or empty parameters are automatically removed from queries, making them act as "optional filters".

### How It Works

1. `quote("")` returns `{ "$ignore": true }` instead of `""`
2. `quote(["a", "", "b"])` filters empty strings → `["a","b"]`
3. `quote(["", ""])` (all empty) returns `{ "$ignore": true }`
4. Before query execution, the pipeline is scanned for `$ignore` markers
5. Fields containing `$ignore` markers are removed
6. Empty `$and`/`$or`/`$in`/`$all`/`$nin` arrays are also removed

### Example

Given a query template where `category` is an empty string:

```javascript
const category = "";  // empty from user input
const query = `{
  "collection": "products",
  "pipeline": [{ "$match": { "status": "active", "category": ${adapter.quote(category)} } }]
}`;
```

With `ignoreEmptyVariables: false` (default):
```json
{ "$match": { "status": "active", "category": "" } }
```
This matches only documents where `category` is literally an empty string.

With `ignoreEmptyVariables: true`:
```json
{ "$match": { "status": "active" } }
```
The `category` filter is removed, matching all documents regardless of category.

### Cleanup Behavior

| Before | After |
|--------|-------|
| `{ "a": "keep", "b": { "$ignore": true } }` | `{ "a": "keep" }` |
| `{ "$or": [{ "a": { "$ignore": true } }] }` | `{}` (empty $or removed) |
| `{ "$and": [{ "$or": [...ignored...] }, { "y": "val" }] }` | `{ "$and": [{ "y": "val" }] }` |
| `{ "tags": { "$in": ["a", { "$ignore": true }] } }` | `{ "tags": { "$in": ["a"] } }` |
| `{ "tags": { "$in": [{ "$ignore": true }] } }` | `{}` (empty $in and parent field removed) |
| `{ "code": { "$regex": { "$ignore": true }, "$options": "i" } }` | `{}` (orphaned $options also removed) |

Works with `$and`, `$or`, `$in`, `$all`, and `$nin` arrays. Orphaned `$options` (without `$regex`) are also removed. Empty `$match` stages are kept (they match all documents).

## Example Usage

```json
{
  "collection": "orders",
  "pipeline": [
    { "$match": { "createdAt": { "$gte": "2024-01-01" } } },
    { "$lookup": {
        "from": "customers",
        "localField": "customerId",
        "foreignField": "_id",
        "as": "customer"
    }},
    { "$unwind": "$customer" },
    { "$project": {
        "orderId": 1,
        "total": 1,
        "customerName": "$customer.name"
    }}
  ]
}
```

## Error Handling

- Transient MongoDB errors trigger automatic fast retry
- Errors are logged with context and mapped to appropriate HTTP status codes
