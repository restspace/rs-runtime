# MongoDbQueryAdapter

Query adapter for running MongoDB aggregation pipelines.

## Configuration

```json
{
  "url": "mongodb://localhost:27017",
  "dbName": "myDatabase",
  "tlsCAFile": "/path/to/ca.pem"  // optional
}
```

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
  "page": {
    "mode": "appendStages"
  },
  "options": {}
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `collection` | Yes | Target collection name (will be normalized) |
| `pipeline` | Yes | MongoDB aggregation pipeline array |
| `page.mode` | No | Paging mode, defaults to `"appendStages"` |
| `options` | No | Additional aggregation options passed to MongoDB |

## Paging

The adapter applies `take` and `skip` parameters automatically based on the `page.mode`:

- `appendStages` (default): Appends `$skip` and `$limit` stages to the pipeline

Default values: `take=1000`, `skip=0`

## Return Values

- **Success**: Array of result documents
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
