# Shared Config Support

GQL Ingest supports shared configuration through `config.yaml` for orchestration settings that apply across entities.

## Entity Files

Each entity is defined by an `entity.json` file placed in its own directory. The entity name is specified by the `name` field inside the file.

### Entity File Structure

```json
{
  "name": "users",
  "dataFile": "users.csv",
  "graphqlFile": "users.graphql",
  "mapping": {
    "name": "user_name",
    "email": "user_email"
  }
}
```

The `name` field is required and determines the entity name used for dependency resolution, logging, and metrics.

### Directory Layout

```
my-project/
├── config.yaml
├── users/
│   ├── entity.json      # entity definition (name: "users")
│   ├── users.csv
│   └── users.graphql
└── products/
    ├── entity.json      # entity definition (name: "products")
    ├── products.json
    └── products.graphql
```

## Shared config.yaml

The `config.yaml` file provides orchestration settings shared across all entities:

```yaml
parallelProcessing:
  concurrency: 5
  entityConcurrency: 2
  preserveRowOrder: false

retry:
  maxAttempts: 3
  baseDelay: 1000
  exponentialBackoff: true

entityDependencies:
  products: ["users"]
  orders: ["products"]

entityConfig:
  users:
    retry:
      maxAttempts: 5
  products:
    concurrency: 10
```

### Config Resolution

GQL Ingest walks up from the entity file's directory to find `config.yaml`. You can also pass it explicitly with `-c`:

```bash
gql-ingest -e http://localhost:4000 -c ./config.yaml users/entity.json products/entity.json
```

When `-c` is not provided, the tool searches parent directories of the entity file for a `config.yaml`.

### Entity Dependencies

Dependencies reference entity names (from the `name` field in `entity.json`), not file paths:

```yaml
entityDependencies:
  orders: ["users", "products"]
```

This means the entity with `"name": "orders"` depends on entities with `"name": "users"` and `"name": "products"`.
