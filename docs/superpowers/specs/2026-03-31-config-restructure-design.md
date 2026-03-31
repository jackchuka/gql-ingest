# Config Restructure Design

**Date:** 2026-03-31

## Overview

This spec describes the restructured configuration format for GQL Ingest. The key changes are:

1. Entity definition files are always named `entity.json`
2. Entity files require a `name` field -- the entity name comes from the file, not the filename or directory
3. Only `dataFile` is supported for referencing data files

## Entity File Format

Every entity is defined by a file named `entity.json`. The `name` field is required and determines the entity's identity.

### Schema

```json
{
  "name": "<entityName>",
  "dataFile": "<path-to-data-file>",
  "dataFormat": "<csv|json|yaml|jsonl>",
  "graphqlFile": "<path-to-mutation-file>",
  "mapping": {
    "<graphqlVariable>": "<dataField>"
  }
}
```

### Example: Users Entity

**users/entity.json**:

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

### Example: Products Entity

**products/entity.json**:

```json
{
  "name": "products",
  "dataFile": "products.json",
  "dataFormat": "json",
  "graphqlFile": "newProduct.graphql",
  "mapping": {
    "input": "$"
  }
}
```

## Directory Layout

```
my-project/
├── config.yaml
├── users/
│   ├── entity.json      # entity definition (name: "users")
│   ├── users.csv
│   └── users.graphql
├── products/
│   ├── entity.json      # entity definition (name: "products")
│   ├── products.json
│   └── products.graphql
└── orders/
    ├── entity.json      # entity definition (name: "orders")
    ├── orders.csv
    └── orders.graphql
```

## CLI Usage

Entity files are passed as positional arguments:

```bash
# Single entity
gql-ingest -e http://localhost:4000 users/entity.json

# Multiple entities
gql-ingest -e http://localhost:4000 users/entity.json products/entity.json

# With shared config
gql-ingest -e http://localhost:4000 -c config.yaml users/entity.json products/entity.json orders/entity.json
```

## Design Decisions

### Fixed filename `entity.json`

Using a fixed filename simplifies tooling and makes it unambiguous which file is the entity definition in any directory. There is exactly one entity per directory.

### `name` field in the file

The entity name is defined inside the file rather than derived from the filename or parent directory. This:

- Makes the entity self-describing
- Allows the directory name to differ from the entity name
- Makes dependency references explicit and predictable
- Simplifies entity resolution in `config.yaml` dependencies

### `dataFile` only

The `dataFile` key is the single way to reference data files. The format is auto-detected from the file extension or can be overridden with `dataFormat`.

## Config.yaml Integration

Entity dependencies in `config.yaml` reference entity names from the `name` field:

```yaml
entityDependencies:
  orders: ["users", "products"]

entityConfig:
  users:
    retry:
      maxAttempts: 5
  products:
    concurrency: 10
```
