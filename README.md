# GQL Ingest

[![npm version](https://badge.fury.io/js/%40jackchuka%2Fgql-ingest.svg)](https://badge.fury.io/js/%40jackchuka%2Fgql-ingest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript CLI tool that reads CSV files and ingests data into GraphQL APIs through configurable mutations.

## Features

- ✅ External GraphQL mutation definitions (separate .graphql files)
- ✅ CSV-to-GraphQL variable mapping via JSON configuration
- ✅ Configurable GraphQL endpoint and headers

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

## Configuration

The `--config` flag points to a configuration directory containing three subdirectories:

- `data/` - CSV files with actual data
- `graphql/` - GraphQL mutation definitions
- `mappings/` - JSON files that map CSV columns to GraphQL variables

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
2. **Processing**: For each mapping file:
   - Reads the corresponding CSV data file
   - Loads the GraphQL mutation definition
   - Maps CSV columns to GraphQL variables
   - Executes the mutation for each CSV row
3. **Error Handling**: Failed mutations are logged but don't stop processing

## License

MIT
