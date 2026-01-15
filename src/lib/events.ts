import { ProcessingMetrics, EntityMetrics } from "./metrics";
import { DataRow } from "../readers";

/**
 * Event types emitted by GQLIngest during processing
 */
export type GQLIngestEventType =
  | "started"
  | "progress"
  | "entityStart"
  | "entityComplete"
  | "rowSuccess"
  | "rowFailure"
  | "cancelled"
  | "finished"
  | "errored";

/**
 * Payload for 'started' event - emitted when ingestion begins
 */
export interface StartedEventPayload {
  /** Path to configuration directory */
  configPath: string;
  /** Total number of entities to process */
  totalEntities: number;
  /** Names of entities that will be processed */
  entityNames: string[];
  /** Number of dependency waves */
  totalWaves: number;
  /** Timestamp when ingestion started */
  startTime: number;
}

/**
 * Payload for 'progress' event - emitted periodically during processing
 */
export interface ProgressEventPayload {
  /** Current wave number (0-indexed) */
  currentWave: number;
  /** Total number of waves */
  totalWaves: number;
  /** Number of entities completed */
  entitiesCompleted: number;
  /** Total number of entities */
  totalEntities: number;
  /** Total rows processed so far */
  rowsProcessed: number;
  /** Number of successful row operations */
  successfulRows: number;
  /** Number of failed row operations */
  failedRows: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
}

/**
 * Payload for 'entityStart' event - emitted when an entity begins processing
 */
export interface EntityStartEventPayload {
  /** Name of the entity being processed */
  entityName: string;
  /** Path to the entity's mapping configuration */
  mappingPath: string;
  /** Total number of rows to process for this entity */
  totalRows: number;
  /** Wave number this entity belongs to */
  waveIndex: number;
}

/**
 * Payload for 'entityComplete' event - emitted when an entity finishes processing
 */
export interface EntityCompleteEventPayload {
  /** Name of the entity that completed */
  entityName: string;
  /** Metrics for this entity */
  metrics: EntityMetrics;
  /** Whether all rows were successful */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Payload for 'rowSuccess' event - emitted for each successful row mutation
 */
export interface RowSuccessEventPayload {
  /** Entity name */
  entityName: string;
  /** Row index (0-indexed) */
  rowIndex: number;
  /** The original row data */
  row: DataRow;
  /** GraphQL mutation result */
  result: unknown;
  /** Duration of the mutation in milliseconds */
  durationMs: number;
}

/**
 * Payload for 'rowFailure' event - emitted for each failed row mutation
 */
export interface RowFailureEventPayload {
  /** Entity name */
  entityName: string;
  /** Row index (0-indexed) */
  rowIndex: number;
  /** The original row data */
  row: DataRow;
  /** Error that occurred */
  error: Error;
  /** Number of retry attempts made */
  retryAttempts: number;
}

/**
 * Payload for 'cancelled' event - emitted when processing is cancelled
 */
export interface CancelledEventPayload {
  /** Reason for cancellation */
  reason: string;
  /** Metrics at time of cancellation */
  metrics: ProcessingMetrics;
  /** Entity being processed when cancelled (if any) */
  currentEntity?: string;
  /** How long processing ran before cancellation */
  elapsedMs: number;
}

/**
 * Payload for 'finished' event - emitted when processing completes successfully
 */
export interface FinishedEventPayload {
  /** Final processing metrics */
  metrics: ProcessingMetrics;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Whether all entities succeeded */
  allSuccessful: boolean;
}

/**
 * Payload for 'errored' event - emitted when a fatal error occurs
 */
export interface ErroredEventPayload {
  /** The error that occurred */
  error: Error;
  /** Metrics at time of error */
  metrics: ProcessingMetrics;
  /** Entity being processed when error occurred (if any) */
  currentEntity?: string;
  /** How long processing ran before error */
  elapsedMs: number;
}

/**
 * Map of event types to their payload types
 */
export interface GQLIngestEventMap {
  started: StartedEventPayload;
  progress: ProgressEventPayload;
  entityStart: EntityStartEventPayload;
  entityComplete: EntityCompleteEventPayload;
  rowSuccess: RowSuccessEventPayload;
  rowFailure: RowFailureEventPayload;
  cancelled: CancelledEventPayload;
  finished: FinishedEventPayload;
  errored: ErroredEventPayload;
}

/**
 * Options for configuring event emission behavior
 */
export interface EventOptions {
  /** Emit rowSuccess/rowFailure events (can be verbose for large datasets). Default: true */
  emitRowEvents?: boolean;
  /** Interval for progress events in milliseconds. Default: 1000 (1 second) */
  progressInterval?: number;
  /** Emit progress events. Default: true */
  emitProgressEvents?: boolean;
}

/**
 * Default event options
 */
export const DEFAULT_EVENT_OPTIONS: Required<EventOptions> = {
  emitRowEvents: true,
  progressInterval: 1000,
  emitProgressEvents: true,
};
