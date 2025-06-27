# Parallel Processing Guide

This guide explains how to configure and use the parallel processing capabilities of gql-ingest.

## Overview

gql-ingest supports two levels of parallelization:

1. **Row-level parallelization** - Process multiple CSV rows concurrently within a single entity
2. **Entity-level parallelization** - Process multiple entities concurrently with dependency management

## Configuration

Add a `config.yaml` file to your configuration directory (same directory as `mappings/`, `data/`, `graphql/`):

```yaml
# Global parallel processing settings
parallelProcessing:
  concurrency: 10 # Max concurrent requests per entity (>1 enables parallel row processing)
  entityConcurrency: 3 # Max concurrent entities processed simultaneously
  preserveRowOrder: false # Allow rows to complete out of order

# Per-entity overrides
entityConfig:
  users:
    concurrency: 1 # Sequential processing
    preserveRowOrder: true # Maintain CSV order
  products:
    concurrency: 20 # High concurrency for bulk data

# Entity dependencies (creates execution waves)
entityDependencies:
  products: ["users"] # Products depend on users
  orders: ["products", "users"] # Orders depend on both
```

## Configuration Options

### Global Settings (`parallelProcessing`)

| Option              | Type    | Default | Description                                                                 |
| ------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `concurrency`       | number  | 1       | Maximum concurrent requests per entity (>1 enables parallel row processing) |
| `entityConcurrency` | number  | 1       | Maximum concurrent entities processed simultaneously                        |
| `preserveRowOrder`  | boolean | true    | Maintain CSV row order (forces concurrency=1)                               |

**Key Insight**: `entityConcurrency` replaces the previous confusing `enableEntityParallelization` and `preserveEntityOrder` boolean settings. Higher values = more entities processed simultaneously.

### Entity Overrides (`entityConfig`)

Override global settings for specific entities:

```yaml
entityConfig:
  entityName:
    concurrency: 5 # Override global concurrency
    preserveRowOrder: true # Override global row order setting
```

### Dependencies (`entityDependencies`)

Define which entities must complete before others can start:

```yaml
entityDependencies:
  products: ["users", "categories"] # Products waits for users AND categories
  orders: ["products"] # Orders waits for products
```

## Execution Flow

### Dependency Resolution

Entities are organized into execution waves based on dependencies:

```yaml
# Configuration
entityDependencies:
  products: ["users", "categories"]
  orders: ["products", "users"]
  reviews: ["products", "users"]
# Execution waves:
# Wave 1: users, categories (no dependencies)
# Wave 2: products (depends on Wave 1)
# Wave 3: orders, reviews (depend on products from Wave 2)
```

### Wave Processing

Within each wave, `entityConcurrency` controls how many entities can process simultaneously:

- **`entityConcurrency: 1`** - Entities in wave processed sequentially (one at a time)
- **`entityConcurrency: 3`** - Up to 3 entities in wave processed concurrently
- **`entityConcurrency: 10`** - Up to 10 entities in wave processed concurrently

**Important**: Wave boundaries are always respected. Wave 2 never starts until Wave 1 is complete.

## Row vs Entity Concurrency

### Row Concurrency (`concurrency`)

Controls processing within a single entity:

```yaml
users:
  preserveRowOrder: true # Process user rows in CSV order
  # Automatically sets concurrency: 1

products:
  preserveRowOrder: false # Rows can complete out of order
  concurrency: 10 # Can process 10 rows concurrently
```

### Entity Concurrency (`entityConcurrency`)

Controls how many entities can process simultaneously within dependency waves:

```yaml
entityConcurrency: 1
# Wave 1: [users, categories] - processed one at a time
# Wave 2: [products] - single entity
# Wave 3: [orders, reviews] - processed one at a time

entityConcurrency: 3
# Wave 1: [users, categories] - both processed concurrently (2 entities)
# Wave 2: [products] - single entity
# Wave 3: [orders, reviews] - both processed concurrently (2 entities)
```

## Performance Guidelines

### Concurrency Recommendations

| Data Type          | Recommended Concurrency | Reasoning                         |
| ------------------ | ----------------------- | --------------------------------- |
| User accounts      | 1-5                     | Sensitive data, avoid rate limits |
| Product catalog    | 10-50                   | Bulk data, higher throughput      |
| Transactional data | 5-15                    | Moderate concurrency              |

### Performance Expectations

Based on typical GraphQL response times (~100ms):

| Concurrency    | Throughput    | Use Case                  |
| -------------- | ------------- | ------------------------- |
| 1 (sequential) | ~10 req/sec   | Sensitive data, debugging |
| 10             | ~100 req/sec  | Standard processing       |
| 20             | ~200 req/sec  | Bulk data import          |
| 50+            | ~500+ req/sec | High-volume scenarios     |

### Memory Considerations

Higher concurrency uses more memory:

- Each concurrent request holds CSV row data
- Large CSV files with high concurrency may require more RAM
- Monitor memory usage and adjust concurrency accordingly

## Error Handling

### Concurrent Error Isolation

- Individual row failures don't stop other concurrent requests
- Failed rows are logged with context
- Success/failure metrics tracked per entity

### Dependency Error Propagation

- If an entity in Wave 1 fails, dependent entities in Wave 2+ are still attempted
- Use metrics to identify systematic failures

## Example Configurations

### High-Throughput Bulk Import

```yaml
parallelProcessing:
  concurrency: 20 # High concurrency enables parallel row processing
  entityConcurrency: 5 # Process up to 5 entities simultaneously
  preserveRowOrder: false

entityConfig:
  users:
    concurrency: 5 # Lower for user data
  products:
    concurrency: 50 # Higher for product catalog
```

### Conservative Processing

```yaml
parallelProcessing:
  concurrency: 2 # Low concurrency with parallel processing
  entityConcurrency: 1 # Process entities one at a time
  preserveRowOrder: true

entityDependencies:
  products: ["users"]
  orders: ["products"]
```

### Mixed Requirements

```yaml
parallelProcessing:
  concurrency: 10 # Moderate concurrency enables parallel processing
  entityConcurrency: 2 # Process up to 2 entities simultaneously

entityConfig:
  # Sensitive data - preserve order
  users:
    concurrency: 1 # Sequential processing (concurrency=1)
    preserveRowOrder: true

  # Reference data - high throughput
  categories:
    concurrency: 20 # Parallel processing (concurrency>1)
    preserveRowOrder: false

  # Transactional data - moderate concurrency
  orders:
    concurrency: 5 # Parallel processing (concurrency>1)
    preserveRowOrder: true

entityDependencies:
  products: ["users", "categories"]
  orders: ["products", "users"]
```

## Troubleshooting

### Common Issues

1. **Server rate limiting** - Reduce concurrency
2. **Memory usage too high** - Lower concurrency or process smaller batches
3. **Unexpected order** - Check `preserveRowOrder` and dependency configuration
4. **Slow performance** - Increase concurrency (if server allows)

### Monitoring

The tool provides detailed metrics:

- Total processed, successes, failures
- Success rate percentage
- Processing duration
- Per-entity breakdown

Use these metrics to optimize concurrency settings for your specific use case.
