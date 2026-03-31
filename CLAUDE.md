# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

gql-ingest is a TypeScript library + CLI for ingesting data from CSV, JSON, YAML, and JSONL files into GraphQL APIs. It supports cross-entity references, dependency-based execution waves, parallel processing, retries with exponential backoff, and real-time event monitoring.

## Commands

```bash
pnpm run build          # esbuild bundling (CLI + library)
pnpm run build:types    # TypeScript declaration files
pnpm run build:all      # build + types

pnpm run dev            # run CLI via ts-node
pnpm run test           # jest
pnpm run test:watch     # jest --watch

pnpm run lint           # oxlint
pnpm run lint:fix       # oxlint --fix
pnpm run fmt            # oxfmt

# Run a single test file
pnpm run test -- src/lib/mapper.test.ts

# Run a single test by name
pnpm run test -- -t "test name pattern"
```

## Architecture

**Entry points:** `src/index.ts` (library exports), `src/cli/index.ts` (Commander.js CLI)

**Core processing pipeline** (`src/lib/`):

1. **`gql-ingest.ts`** — Main `GQLIngest` class (extends EventEmitter). Orchestrates ingestion: loads config, resolves entity dependencies into execution waves, processes entities wave-by-wave with abort support.
2. **`dependency-resolver.ts`** — Topological sort producing `ExecutionWaves` (groups of entities that can run in parallel). Detects circular dependencies.
3. **`mapper.ts`** — Reads entity config, loads data via readers, maps rows to GraphQL variables (supports JSONPath, direct mapping `$`, cross-entity `$ref`), executes mutations sequentially or concurrently in chunks.
4. **`graphql-client.ts`** — Wraps `graphql-request` with configurable retry (exponential backoff + jitter) and AbortController support.
5. **`config.ts` / `config-schema.ts`** — YAML config loading with Zod validation. Merging order: CLI options > entity overrides > global defaults.
6. **`metrics.ts`** — Per-entity and global processing metrics (rows, durations, retries).
7. **`events.ts`** — Strongly-typed event definitions: started, progress, entityStart/Complete, rowSuccess/Failure, finished, cancelled, errored.
8. **`logger.ts`** — Silent-by-default (noopLogger), opt-in via `createConsoleLogger`.

**Data readers** (`src/readers/`): Factory pattern with auto-registration. CSV, JSON, YAML, JSONL readers extend abstract `DataReader`.

**CLI commands** (`src/cli/commands/`): `init` scaffolds config directory, `add` adds new entities.

## Key Patterns

- **ES Modules** — `"type": "module"` throughout, ES2020 target, bundler module resolution
- **Event-driven** — GQLIngest emits typed events for real-time monitoring; listeners never block processing
- **Cross-entity references** — Entity A captures output via `outputCapture`, Entity B uses `$ref` to look up values from A's `OutputStore`
- **Wave execution** — Dependency resolver groups entities into waves; within a wave, entities run up to `entityConcurrency` in parallel; within an entity, rows run up to `concurrency` in parallel
- **Tests** — Co-located `*.test.ts` files using Jest with ts-jest; heavy use of `jest.mock()` for fs and GraphQL operations
