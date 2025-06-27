# GQL Ingest

[![npm version](https://badge.fury.io/js/%40jackchuka%2Fgql-ingest.svg)](https://badge.fury.io/js/%40jackchuka%2Fgql-ingest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript CLI tool that reads CSV files and ingests data into GraphQL APIs through configurable mutations.

## Features

- ✅ External GraphQL mutation definitions (separate .graphql files)
- ✅ CSV-to-GraphQL variable mapping via JSON configuration
- ✅ Configurable GraphQL endpoint and headers
- ✅ **Parallel processing** with dependency management
- ✅ Entity-level and row-level concurrency control
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

### CLI Options

```bash
gql-ingest [options]

Options:
  -V, --version            output the version number
  -e, --endpoint <url>     GraphQL endpoint URL (required)
  -c, --config <path>      Path to configuration directory (required)
  -h, --headers <headers>  JSON string of headers to include in requests
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
  concurrency: 10          # Process up to 10 CSV rows per entity concurrently
  entityConcurrency: 3     # Process up to 3 entities simultaneously
  preserveRowOrder: false  # Allow rows to complete out of order for speed

# Define dependencies between entities  
entityDependencies:
  products: ["users"]       # Products must wait for users to complete
  orders: ["products"]      # Orders must wait for products to complete
```

**Performance Impact**: This configuration can process data **10-50x faster** than sequential processing, depending on your GraphQL API's capabilities.

👉 **[Full Parallel Processing Guide](PARALLEL_PROCESSING.md)** - Detailed configuration options, performance tuning, and examples.

## Configuration

The `--config` flag points to a configuration directory containing three subdirectories:

- `data/` - CSV files with actual data
- `graphql/` - GraphQL mutation definitions
- `mappings/` - JSON files that map CSV columns to GraphQL variables
- `config.yaml` - *(Optional)* Parallel processing and dependency configuration

Each entity has three corresponding files across these directories with matching names.

### Example Configuration

**examples/demo/mappings/items.json**:

```json
{
  "csvFile": "data/items.csv",
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

**examples/demo/config.yaml** *(Optional - for parallel processing)*:

```yaml
parallelProcessing:
  concurrency: 5           # Process 5 rows per entity concurrently
  entityConcurrency: 2     # Process 2 entities simultaneously
  preserveRowOrder: false  # Allow faster out-of-order completion

entityDependencies:
  items: ["users"]         # Items depend on users being processed first
```

## Development

### Scripts

```bash
npm run build        # Build CLI bundle with esbuild
npm run build:types  # Generate TypeScript declarations
npm run build:all    # Build bundle + types
npm run dev          # Run in development mode
npm run test         # Run test suite
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Testing

The project includes comprehensive unit tests for all modules:

```bash
npm test              # Run all tests
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
5. **Error Handling & Metrics**: 
   - Failed mutations are logged but don't stop processing
   - Real-time progress tracking and success/failure metrics
   - Detailed per-entity performance breakdown

## License

MIT
