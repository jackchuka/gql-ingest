// Main programmatic API exports
export { GQLIngest } from "./lib/gql-ingest";
export type { GQLIngestOptions, IngestOptions, IngestResult } from "./lib/gql-ingest";

// Event types
export type {
  GQLIngestEventType,
  GQLIngestEventMap,
  EventOptions,
  StartedEventPayload,
  ProgressEventPayload,
  EntityStartEventPayload,
  EntityCompleteEventPayload,
  RowSuccessEventPayload,
  RowFailureEventPayload,
  CancelledEventPayload,
  FinishedEventPayload,
  ErroredEventPayload,
} from "./lib/events";
export { DEFAULT_EVENT_OPTIONS } from "./lib/events";

// Logger exports
export type { Logger, ConsoleLoggerOptions } from "./lib/logger";
export { noopLogger, createConsoleLogger, createDefaultLogger } from "./lib/logger";

// Core components for advanced usage
export { GraphQLClientWrapper } from "./lib/graphql-client";
export { DataMapper } from "./lib/mapper";
export { DependencyResolver } from "./lib/dependency-resolver";
export { MetricsCollector } from "./lib/metrics";

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
} from "./lib/config";

// Data reader components
export {
  DataReader,
  DataRow,
  DataReaderFactory,
  CsvReader,
  JsonReader,
  YamlReader,
  JsonlReader,
} from "./readers";

// Type exports
export type { MappingConfig, EntityProcessingCallbacks } from "./lib/mapper";

export type { EntityMetrics, ProcessingMetrics } from "./lib/metrics";

export type { DependencyGraph, ExecutionWave } from "./lib/dependency-resolver";
