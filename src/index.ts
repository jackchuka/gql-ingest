// Main programmatic API exports
export { GQLIngest } from "./gql-ingest";
export type { GQLIngestOptions, IngestOptions, IngestResult } from "./gql-ingest";

// Logger exports
export type { Logger } from "./logger";
export { noopLogger, createConsoleLogger, createDefaultLogger } from "./logger";

// Core components for advanced usage
export { GraphQLClientWrapper } from "./graphql-client";
export { DataMapper } from "./mapper";
export { DependencyResolver } from "./dependency-resolver";
export { MetricsCollector } from "./metrics";

// Configuration interfaces
export {
  ParallelProcessingConfig,
  RetryConfig,
  EntityConfig,
  ProcessingConfig,
  FullConfig,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_PARALLEL_CONFIG,
  DEFAULT_CONFIG,
  loadConfig,
  getEntityConfig,
  getRetryConfig,
} from "./config";

// Data reader components
export {
  DataReader,
  DataRow,
  DataReaderFactory,
  CsvReader,
  JsonReader,
  YamlReader,
  JsonlReader,
  readCsvFile,
  CsvRow,
} from "./readers";

// Type exports
export type { MappingConfig } from "./mapper";

export type { EntityMetrics, ProcessingMetrics } from "./metrics";

export type { DependencyGraph, ExecutionWave } from "./dependency-resolver";
