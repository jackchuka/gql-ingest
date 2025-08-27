# GQL Ingest

[![npm version](https://badge.fury.io/js/%40jackchuka%2Fgql-ingest.svg)](https://badge.fury.io/js/%40jackchuka%2Fgql-ingest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript library and CLI tool that reads data from multiple formats (CSV, JSON, YAML, JSONL) and ingests it into GraphQL APIs through configurable mutations.

## Features

- ✅ **Supported data formats**: CSV, JSON, YAML, JSONL
- ✅ **Complex nested data support** for sophisticated GraphQL mutations
- ✅ External GraphQL mutation definitions (separate .graphql files)
- ✅ Flexible data-to-GraphQL variable mapping via JSON configuration
- ✅ Configurable GraphQL endpoint and headers
- ✅ **Parallel processing** with dependency management
- ✅ Entity-level and row-level concurrency control
- ✅ **Retry capabilities** with exponential backoff and configurable error handling
- ✅ Comprehensive metrics and progress tracking

## Installation

### For End Users

```bash
# Install globally
npm install -g @jackchuka/gql-ingest

# Or use with npx (no installation required)
npx @jackchuka/gql-ingest --endpoint <url> --config <path>
```

### For Development

```bash
git clone https://github.com/jackchuka/gql-ingest.git
cd gql-ingest
npm install
npm run build
```

## Usage

### Programmatic API

GQL Ingest provides a full programmatic API for integration into your Node.js applications.

#### Installation for API Usage

```bash
npm install @jackchuka/gql-ingest
```

#### Basic API Usage

```typescript
import { GQLIngest } from "@jackchuka/gql-ingest";

// Initialize the client
const client = new GQLIngest({
  endpoint: "https://your-graphql-api.com/graphql",
  headers: {
    Authorization: "Bearer YOUR_TOKEN",
  },
  verbose: true, // Optional: enable verbose logging
});

// Ingest all data from a configuration
const result = await client.ingest("./config");

// Check if ingestion was successful
if (result.success) {
  console.log("Ingestion completed successfully");
  console.log("Metrics:", result.metrics);
} else {
  console.error("Ingestion failed:", result.errors);
}
```

#### Processing Specific Entities

```typescript
// Process only specific entities
const result = await client.ingestEntities("./config", ["users", "products"]);

// Or using the ingest method with options
const result = await client.ingest("./config", {
  entities: ["users", "products"],
  verbose: true,
});
```

#### Advanced API Usage

For more control, you can access the underlying components directly:

```typescript
import {
  GraphQLClientWrapper,
  DataMapper,
  DependencyResolver,
  MetricsCollector,
  loadConfig,
} from "@jackchuka/gql-ingest";

// Create your own custom workflow
const metrics = new MetricsCollector();
const client = new GraphQLClientWrapper(endpoint, headers, metrics, verbose);
const mapper = new DataMapper(client, basePath, metrics, verbose);

// Load configuration
const config = loadConfig("./config");

// Process entities with custom logic
// ... your custom implementation
```

#### API Methods

**GQLIngest Class Methods:**

- `constructor(options: GQLIngestOptions)` - Initialize the client
- `ingest(configPath: string, options?: IngestOptions)` - Ingest data from a configuration
- `ingestEntities(configPath: string, entities: string[])` - Process specific entities
- `getMetrics()` - Get current processing metrics
- `getMetricsSummary()` - Get formatted metrics summary
- `setVerbose(verbose: boolean)` - Update verbose mode
- `setHeaders(headers: Record<string, string>)` - Update request headers

#### TypeScript Support

Full TypeScript support is included with comprehensive type definitions:

```typescript
import type {
  GQLIngestOptions,
  IngestOptions,
  IngestResult,
  ProcessingMetrics,
  EntityMetrics,
} from "@jackchuka/gql-ingest";
```

### CLI Options

```bash
gql-ingest [options]

Options:
  -V, --version            output the version number
  -e, --endpoint <url>     GraphQL endpoint URL (required)
  -c, --config <path>      Path to configuration directory (required)
  -n, --entities <list>    Comma-separated list of specific entities to process
  -h, --headers <headers>  JSON string of headers to include in requests
  -f, --format <format>    Override data format detection (csv, json, yaml, jsonl)
  -v, --verbose            Show detailed request results and responses
  --help                   display help for command
```

### Examples

```bash
# Basic usage
npx @jackchuka/gql-ingest \
  --endpoint https://your-graphql-api.com/graphql \
  --config ./examples/demo

# With authentication headers
npx @jackchuka/gql-ingest \
  --endpoint https://your-graphql-api.com/graphql \
  --config ./examples/demo \
  --headers '{"Authorization": "Bearer YOUR_TOKEN"}'

# With custom headers
npx @jackchuka/gql-ingest \
  --endpoint https://api.example.com/graphql \
  --config ./my-config \
  --headers '{"X-API-Key": "your-api-key", "Content-Type": "application/json"}'

# Process specific entities only
npx @jackchuka/gql-ingest \
  --endpoint https://your-graphql-api.com/graphql \
  --config ./examples/demo \
  --entities users,products

# Process a single entity
npx @jackchuka/gql-ingest \
  --endpoint https://your-graphql-api.com/graphql \
  --config ./examples/demo \
  --entities items
```

## Parallel Processing 🚀

GQL Ingest supports advanced parallel processing with dependency management for high-performance data ingestion:

### Key Capabilities

- **Entity-level parallelism**: Process multiple entities (users, products, orders) concurrently
- **Row-level parallelism**: Process multiple CSV rows within an entity concurrently
- **Dependency management**: Ensure entities process in the correct order (e.g., users before orders)
- **Smart batching**: Control exactly how many entities/rows process simultaneously
- **Real-time metrics**: Track progress, success rates, and performance

### Quick Example

```yaml
# config.yaml - Add to your configuration directory
parallelProcessing:
  concurrency: 10 # Process up to 10 CSV rows per entity concurrently
  entityConcurrency: 3 # Process up to 3 entities simultaneously
  preserveRowOrder: false # Allow rows to complete out of order for speed

# Define dependencies between entities
entityDependencies:
  products: ["users"] # Products must wait for users to complete
  orders: ["products"] # Orders must wait for products to complete
```

**Performance Impact**: This configuration can process data **10-50x faster** than sequential processing, depending on your GraphQL API's capabilities.

👉 **[Full Parallel Processing Guide](PARALLEL_PROCESSING.md)** - Detailed configuration options, performance tuning, and examples.

## Retry Capabilities 🔄

GQL Ingest includes robust retry functionality to handle transient failures and improve reliability:

### Key Features

- **Automatic retries**: Failed GraphQL mutations are retried automatically
- **Exponential backoff**: Intelligent delay increases between retry attempts
- **Jitter**: Randomization prevents thundering herd problems
- **Configurable error codes**: Control which HTTP status codes trigger retries
- **Per-entity overrides**: Different retry settings for different entities
- **Metrics tracking**: Monitor retry success rates and attempt counts

### Quick Example

```yaml
# config.yaml - Add to your configuration directory
retry:
  maxAttempts: 5 # Retry up to 5 times (default: 3)
  baseDelay: 2000 # Start with 2s delay (default: 1000ms)
  maxDelay: 60000 # Cap delays at 60s (default: 30000ms)
  exponentialBackoff: true # Double delay each retry (default: true)
  retryableStatusCodes: # Which HTTP errors to retry (defaults shown)
    - 408 # Request Timeout
    - 429 # Too Many Requests
    - 500 # Internal Server Error
    - 502 # Bad Gateway
    - 503 # Service Unavailable
    - 504 # Gateway Timeout

# Per-entity retry overrides
entityConfig:
  critical-orders:
    retry:
      maxAttempts: 10 # More retries for critical data
      baseDelay: 500 # Faster initial retry
```

**Reliability Impact**: Retry capabilities can improve success rates from 95% to 99.9%+ for APIs with transient failures.

## Selective Entity Processing

The `--entities` flag allows you to process specific entities instead of all discovered mappings:

- Process multiple entities: `--entities users,products,orders`
- Process a single entity: `--entities items`
- Entities are processed in dependency order automatically
- Missing dependencies will trigger a warning but not prevent execution

**Note**: When using `--entities` with entity dependencies defined in `config.yaml`, the tool will warn you about any missing dependencies but will still attempt to process the selected entities. Ensure dependent data exists in your GraphQL API before processing entities with unmet dependencies.

## Configuration

The `--config` flag points to a configuration directory containing these necessary files:

- `mappings/` - JSON files that map CSV columns to GraphQL variables
- `config.yaml` - _(Optional)_ Parallel processing and dependency configuration

Each entity has three corresponding files across these directories with matching names.

### Example Configuration

**examples/demo/mappings/items.json**:

```json
{
  "dataFile": "data/items.csv",
  "dataFormat": "csv",
  "graphqlFile": "graphql/items.graphql",
  "mapping": {
    "name": "item_name",
    "sku": "item_sku"
  }
}
```

**examples/demo/data/items.csv**:

```csv
item_name,item_sku
Item1,item-1-sku
Item2,item-2-sku
```

**examples/demo/graphql/items.graphql**:

```graphql
mutation CreateItem($name: String!, $sku: String!) {
  createItem(input: { name: $name, sku: $sku }) {
    id
    name
    sku
  }
}
```

**examples/demo/config.yaml** _(Optional - for parallel processing and retry configuration)_:

```yaml
# Parallel processing configuration
parallelProcessing:
  concurrency: 5 # Process 5 rows per entity concurrently
  entityConcurrency: 2 # Process 2 entities simultaneously
  preserveRowOrder: false # Allow faster out-of-order completion

# Global retry configuration
retry:
  maxAttempts: 3 # Retry failed requests up to 3 times
  baseDelay: 1000 # Start with 1s delay between retries
  exponentialBackoff: true # Double delay each retry

# Entity dependencies
entityDependencies:
  items: ["users"] # Items depend on users being processed first

# Per-entity overrides (optional)
entityConfig:
  users:
    retry:
      maxAttempts: 5 # More retries for user creation
  items:
    concurrency: 10 # Higher concurrency for items
```

## Supported Data Formats 📄

GQL Ingest now supports multiple data formats beyond CSV for more flexible data ingestion, especially for complex nested GraphQL mutations:

### Supported Formats

- **CSV** - Traditional flat file format
- **JSON** - Perfect for nested/complex data structures
- **YAML** - Human-friendly alternative to JSON
- **JSONL** - JSON Lines format for streaming large datasets

### Format Selection

The tool automatically detects the format based on file extension, or you can specify it explicitly:

```bash
# Auto-detect from mapping configuration
gql-ingest --endpoint <url> --config ./config

# Force specific format
gql-ingest --endpoint <url> --config ./config --format json
```

### JSON/YAML Format Examples

#### Direct Mapping (Entire Object)

For complex GraphQL mutations with nested input types, you can map the entire data object:

**data/products.json**:

```json
[
  {
    "name": "Premium T-Shirt",
    "type": "PHYSICAL",
    "options": [
      {
        "name": "Color",
        "values": ["Red", "Blue", "Green"]
      },
      {
        "name": "Size",
        "values": ["S", "M", "L", "XL"]
      }
    ],
    "variants": [
      {
        "name": "Red Small",
        "sku": "TS-RED-S",
        "optionMappings": [
          { "name": "Color", "value": "Red" },
          { "name": "Size", "value": "S" }
        ]
      }
    ]
  }
]
```

**mappings/products.json**:

```json
{
  "dataFile": "data/products.json",
  "dataFormat": "json",
  "graphqlFile": "graphql/newProduct.graphql",
  "mapping": {
    "input": "$" // Map entire object to input variable
  }
}
```

#### Path-Based Mapping

For transforming flat JSON into nested structures:

**data/products-flat.json**:

```json
[
  {
    "product_name": "Notebook",
    "product_type": "PHYSICAL",
    "brand": "ACME"
  }
]
```

**mappings/products-flat.json**:

```json
{
  "dataFile": "data/products-flat.json",
  "graphqlFile": "graphql/newProduct.graphql",
  "mapping": {
    "input": {
      "name": "$.product_name",
      "type": "$.product_type",
      "brandCode": "$.brand"
    }
  }
}
```

### YAML Format

YAML provides a more readable alternative:

**data/products.yaml**:

```yaml
- name: Premium T-Shirt
  type: PHYSICAL
  options:
    - name: Color
      values: [Red, Blue, Green]
    - name: Size
      values: [S, M, L, XL]
  variants:
    - name: Red Small
      sku: TS-RED-S
      optionMappings:
        - name: Color
          value: Red
        - name: Size
          value: S
```

## Development

### Scripts

```bash
npm run build       # Build CLI bundle with esbuild
npm run build:types # Generate TypeScript declarations
npm run build:all   # Build bundle + types
npm run dev         # Run in development mode
npm run test        # Run test suite
```

## How It Works

1. **Discovery**: The tool scans the `mappings/` directory for `.json` files
2. **Dependency Resolution**: Analyzes `entityDependencies` to create execution waves
3. **Parallel Processing**: For each dependency wave:
   - Processes up to `entityConcurrency` entities simultaneously
   - Within each entity, processes up to `concurrency` CSV rows concurrently
   - Waits for the entire wave to complete before starting the next wave
4. **GraphQL Execution**: For each CSV row:
   - Loads the GraphQL mutation definition
   - Maps CSV columns to GraphQL variables using the mapping configuration
   - Executes the mutation against the GraphQL endpoint
5. **Error Handling & Retries**:
   - Failed mutations are automatically retried with exponential backoff
   - Non-retryable errors (e.g., validation failures) are logged and skipped
   - Configurable retry policies per entity type
6. **Metrics & Monitoring**:
   - Real-time progress tracking and success/failure rates
   - Retry attempt counts and success rates
   - Detailed per-entity performance breakdown

## License

MIT
