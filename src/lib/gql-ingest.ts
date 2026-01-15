import { EventEmitter } from "events";
import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper } from "./mapper";
import { MetricsCollector, ProcessingMetrics } from "./metrics";
import { DependencyResolver } from "./dependency-resolver";
import { loadConfig, getEntityConfig, getRetryConfig, ProcessingConfig } from "./config";
import { Logger, noopLogger } from "./logger";
import { basename } from "path";
import {
  GQLIngestEventMap,
  EventOptions,
  DEFAULT_EVENT_OPTIONS,
  StartedEventPayload,
  ProgressEventPayload,
  CancelledEventPayload,
  FinishedEventPayload,
  ErroredEventPayload,
} from "./events";

/**
 * Options for initializing GQLIngest client
 */
export interface GQLIngestOptions {
  /** GraphQL endpoint URL */
  endpoint: string;
  /** Optional headers to include in GraphQL requests */
  headers?: Record<string, string>;
  /** Logger instance. Defaults to silent no-op logger. */
  logger?: Logger;
  /** Override data format detection (csv, json, yaml, jsonl) */
  formatOverride?: string;
  /** Event emission options */
  eventOptions?: EventOptions;
}

/**
 * Options for ingesting data
 */
export interface IngestOptions {
  /** Comma-separated list or array of specific entities to process */
  entities?: string[] | string;
  /** Override data format detection for this operation */
  format?: string;
  /** AbortSignal for external cancellation */
  signal?: AbortSignal;
}

/**
 * Result of an ingestion operation
 */
export interface IngestResult {
  /** Processing metrics */
  metrics: ProcessingMetrics;
  /** Whether the operation was successful */
  success: boolean;
  /** Any errors that occurred */
  errors?: string[];
  /** Whether the operation was cancelled */
  cancelled?: boolean;
}

/**
 * Main class for programmatic access to gql-ingest functionality.
 * Extends EventEmitter for progress monitoring and cancellation support.
 */
export class GQLIngest extends EventEmitter {
  private endpoint: string;
  private headers: Record<string, string>;
  private logger: Logger;
  private formatOverride?: string;
  private metrics: MetricsCollector;
  private client: GraphQLClientWrapper;
  private mapper: DataMapper;
  private eventOptions: Required<EventOptions>;

  // Cancellation state
  private abortController: AbortController | null = null;
  private isProcessing = false;
  private startTime = 0;
  private progressIntervalId: ReturnType<typeof setInterval> | null = null;

  // Processing state for progress tracking
  private currentWave = 0;
  private totalWaves = 0;
  private entitiesCompleted = 0;
  private totalEntities = 0;
  private currentEntity: string | undefined;

  constructor(options: GQLIngestOptions) {
    super();
    this.endpoint = options.endpoint;
    this.headers = options.headers || {};
    this.logger = options.logger ?? noopLogger;
    this.formatOverride = options.formatOverride;
    this.eventOptions = { ...DEFAULT_EVENT_OPTIONS, ...options.eventOptions };

    // Initialize components
    this.metrics = new MetricsCollector();
    this.client = new GraphQLClientWrapper(this.endpoint, this.headers, this.metrics, this.logger);
    this.mapper = new DataMapper(
      this.client,
      process.cwd(),
      this.metrics,
      this.logger,
      this.formatOverride,
    );
  }

  /**
   * Cancel the current ingestion process
   * @param reason Optional reason for cancellation
   */
  cancel(reason = "User requested cancellation"): void {
    if (this.abortController && this.isProcessing) {
      this.abortController.abort(reason);
    }
  }

  /**
   * Check if processing is currently in progress
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Safely emit an event, catching any errors from listeners
   */
  private safeEmit<K extends keyof GQLIngestEventMap>(
    event: K,
    payload: GQLIngestEventMap[K],
  ): boolean {
    try {
      return this.emit(event, payload);
    } catch (error) {
      this.logger.error(`Error in event listener for '${String(event)}':`, error);
      return false;
    }
  }

  /**
   * Start the progress interval timer
   */
  private startProgressInterval(): void {
    if (!this.eventOptions.emitProgressEvents) return;

    this.progressIntervalId = setInterval(() => {
      this.emitProgressEvent();
    }, this.eventOptions.progressInterval);
  }

  /**
   * Stop the progress interval timer
   */
  private stopProgressInterval(): void {
    if (this.progressIntervalId) {
      clearInterval(this.progressIntervalId);
      this.progressIntervalId = null;
    }
  }

  /**
   * Emit a progress event with current state
   */
  private emitProgressEvent(): void {
    const metrics = this.metrics.getMetrics();
    const payload: ProgressEventPayload = {
      currentWave: this.currentWave,
      totalWaves: this.totalWaves,
      entitiesCompleted: this.entitiesCompleted,
      totalEntities: this.totalEntities,
      rowsProcessed: metrics.totalRows,
      successfulRows: metrics.successfulOperations,
      failedRows: metrics.failedOperations,
      progressPercent:
        this.totalEntities > 0 ? (this.entitiesCompleted / this.totalEntities) * 100 : 0,
      elapsedMs: Date.now() - this.startTime,
    };
    this.safeEmit("progress", payload);
  }

  /**
   * Handle cancellation and emit event
   */
  private handleCancellation(reason: string): IngestResult {
    this.stopProgressInterval();

    const payload: CancelledEventPayload = {
      reason: reason || "Cancelled",
      metrics: this.metrics.getMetrics(),
      currentEntity: this.currentEntity,
      elapsedMs: Date.now() - this.startTime,
    };
    this.safeEmit("cancelled", payload);

    return {
      metrics: this.metrics.getMetrics(),
      success: false,
      cancelled: true,
      errors: [`Operation cancelled: ${reason}`],
    };
  }

  /**
   * Combine multiple AbortSignals into one
   */
  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      signal.addEventListener("abort", () => controller.abort(signal.reason), {
        once: true,
      });
    }

    return controller.signal;
  }

  /**
   * Ingest data from a configuration directory
   * @param configPath Path to configuration directory (containing data/, graphql/, mappings/ subdirectories)
   * @param options Optional ingestion options
   * @returns Promise with ingestion result
   */
  async ingest(configPath: string, options?: IngestOptions): Promise<IngestResult> {
    const errors: string[] = [];

    // Setup cancellation
    this.abortController = new AbortController();
    const signal = options?.signal
      ? this.combineSignals(options.signal, this.abortController.signal)
      : this.abortController.signal;

    this.isProcessing = true;
    this.startTime = Date.now();
    this.entitiesCompleted = 0;
    this.currentWave = 0;
    this.currentEntity = undefined;

    try {
      // Check for pre-cancelled signal
      if (signal.aborted) {
        return this.handleCancellation(signal.reason);
      }

      // Reset metrics for new operation
      this.metrics = new MetricsCollector();

      // Update client and mapper with new metrics and logger
      this.client = new GraphQLClientWrapper(
        this.endpoint,
        this.headers,
        this.metrics,
        this.logger,
      );

      this.mapper = new DataMapper(
        this.client,
        process.cwd(),
        this.metrics,
        this.logger,
        options?.format ?? this.formatOverride,
      );

      // Load configuration
      const config = loadConfig(configPath, this.logger);

      // Parse entities filter if provided
      let entityFilter: string[] | undefined;
      if (options?.entities) {
        if (typeof options.entities === "string") {
          entityFilter = options.entities.split(",").map((e: string) => e.trim());
        } else {
          entityFilter = options.entities;
        }
      }

      // Discover all mapping files dynamically
      const mappingPaths = this.mapper.discoverMappings(configPath, entityFilter);

      if (mappingPaths.length === 0) {
        const filterMsg = entityFilter ? ` matching entities: ${entityFilter.join(", ")}` : "";
        const warning = `No mapping files found in ${configPath}/mappings${filterMsg}`;
        this.logger.warn(warning);
        return {
          metrics: this.metrics.getMetrics(),
          success: false,
          errors: [warning],
        };
      }

      // Extract entity names from mapping paths
      const entityNames = mappingPaths.map((path) => basename(path, ".json"));
      this.totalEntities = entityNames.length;

      // Filter dependencies to only include those relevant to selected entities
      const relevantDependencies: Record<string, string[]> = {};
      if (config.entityDependencies) {
        for (const entity of entityNames) {
          if (config.entityDependencies[entity]) {
            relevantDependencies[entity] = config.entityDependencies[entity];
          }
        }
      }

      // Setup dependency resolver with filtered dependencies
      const resolver = new DependencyResolver(
        entityNames,
        relevantDependencies,
        !!entityFilter, // Allow partial resolution when using --entities
      );

      // Validate dependencies
      const validationErrors = resolver.validateDependencies();
      if (validationErrors.length > 0) {
        if (entityFilter) {
          // When using entities filter, show warnings instead of errors
          this.logger.warn("\n⚠️  Warning: Dependency validation issues:");
          validationErrors.forEach((error) => this.logger.warn(`  - ${error}`));
          this.logger.warn("This may cause errors if the dependent data doesn't already exist.\n");
        } else {
          // Strict validation when processing all entities
          this.logger.error("Dependency validation errors:");
          validationErrors.forEach((error) => {
            this.logger.error(`  - ${error}`);
            errors.push(error);
          });
          return {
            metrics: this.metrics.getMetrics(),
            success: false,
            errors,
          };
        }
      }

      const waves = resolver.resolveExecutionOrder();
      this.totalWaves = waves.length;

      // Emit started event
      const startedPayload: StartedEventPayload = {
        configPath,
        totalEntities: entityNames.length,
        entityNames,
        totalWaves: waves.length,
        startTime: this.startTime,
      };
      this.safeEmit("started", startedPayload);

      // Start progress interval
      this.startProgressInterval();

      // Process entities with abort checking
      await this.processEntitiesInWaves(
        mappingPaths,
        resolver,
        this.mapper,
        config,
        this.logger,
        signal,
      );

      // Check if cancelled during processing
      if (signal.aborted) {
        return this.handleCancellation(signal.reason);
      }

      this.metrics.finishProcessing();
      this.stopProgressInterval();

      const finalMetrics = this.metrics.getMetrics();
      const allSuccessful = finalMetrics.failedOperations === 0;

      // Emit finished event
      const finishedPayload: FinishedEventPayload = {
        metrics: finalMetrics,
        durationMs: Date.now() - this.startTime,
        allSuccessful,
      };
      this.safeEmit("finished", finishedPayload);

      return {
        metrics: finalMetrics,
        success: true,
      };
    } catch (error) {
      this.stopProgressInterval();

      if (signal.aborted) {
        return this.handleCancellation(signal.reason);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error: ${errorMessage}`);
      errors.push(errorMessage);

      // Emit errored event
      const erroredPayload: ErroredEventPayload = {
        error: error instanceof Error ? error : new Error(String(error)),
        metrics: this.metrics.getMetrics(),
        currentEntity: this.currentEntity,
        elapsedMs: Date.now() - this.startTime,
      };
      this.safeEmit("errored", erroredPayload);

      return {
        metrics: this.metrics.getMetrics(),
        success: false,
        errors,
      };
    } finally {
      this.isProcessing = false;
      this.abortController = null;
      this.stopProgressInterval();
    }
  }

  /**
   * Ingest specific entities from a configuration directory
   * @param configPath Path to configuration directory
   * @param entities Array of entity names to process
   * @returns Promise with ingestion result
   */
  async ingestEntities(configPath: string, entities: string[]): Promise<IngestResult> {
    return this.ingest(configPath, { entities });
  }

  /**
   * Get current processing metrics
   * @returns Current metrics
   */
  getMetrics(): ProcessingMetrics {
    return this.metrics.getMetrics();
  }

  /**
   * Get a summary of the current metrics
   * @returns Formatted summary string
   */
  getMetricsSummary(): string {
    return this.metrics.generateSummary();
  }

  /**
   * Get the GraphQL client for advanced usage
   * @returns GraphQL client wrapper
   */
  getClient(): GraphQLClientWrapper {
    return this.client;
  }

  /**
   * Get the data mapper for advanced usage
   * @returns Data mapper
   */
  getMapper(): DataMapper {
    return this.mapper;
  }

  /**
   * Set the logger instance
   * @param logger Logger instance to use
   */
  setLogger(logger: Logger): void {
    this.logger = logger;
    this.client = new GraphQLClientWrapper(this.endpoint, this.headers, this.metrics, logger);
    this.mapper = new DataMapper(
      this.client,
      process.cwd(),
      this.metrics,
      logger,
      this.formatOverride,
    );
  }

  /**
   * Update headers for GraphQL requests
   * @param headers New headers to use
   */
  setHeaders(headers: Record<string, string>): void {
    this.headers = headers;
    this.client = new GraphQLClientWrapper(this.endpoint, headers, this.metrics, this.logger);
    this.mapper = new DataMapper(
      this.client,
      process.cwd(),
      this.metrics,
      this.logger,
      this.formatOverride,
    );
  }

  /**
   * Process entities in dependency-aware waves with abort support
   */
  private async processEntitiesInWaves(
    mappingPaths: string[],
    resolver: DependencyResolver,
    mapper: DataMapper,
    config: ProcessingConfig,
    logger: Logger,
    signal?: AbortSignal,
  ): Promise<void> {
    const waves = resolver.resolveExecutionOrder();
    const pathMap = new Map(mappingPaths.map((path) => [basename(path, ".json"), path]));

    logger.info(`Processing ${waves.length} dependency waves...`);

    for (const wave of waves) {
      // Check for cancellation before each wave
      if (signal?.aborted) {
        return;
      }

      this.currentWave = wave.wave;
      logger.info(`Wave ${wave.wave + 1}: Processing entities [${wave.entities.join(", ")}]`);

      // Process entities in controlled batches based on entityConcurrency
      const entityConcurrency = config.parallelProcessing.entityConcurrency;
      const chunks = this.chunkArray(wave.entities, entityConcurrency);

      for (const chunk of chunks) {
        // Check for cancellation before each chunk
        if (signal?.aborted) {
          return;
        }

        const entityPromises = chunk.map(async (entityName) => {
          // Check for cancellation before processing each entity
          if (signal?.aborted) {
            return;
          }

          const configPath = pathMap.get(entityName);
          if (configPath) {
            this.currentEntity = entityName;
            try {
              const entityConfig = getEntityConfig(entityName, config, logger);
              const retryConfig = getRetryConfig(entityName, config);

              // Process entity with event callbacks
              await mapper.processEntityWithEvents(configPath, entityConfig, retryConfig, signal, {
                onEntityStart: (payload) =>
                  this.safeEmit("entityStart", {
                    ...payload,
                    waveIndex: wave.wave,
                  }),
                onEntityComplete: (payload) => {
                  this.entitiesCompleted++;
                  this.safeEmit("entityComplete", payload);
                },
                onRowSuccess: this.eventOptions.emitRowEvents
                  ? (payload) => this.safeEmit("rowSuccess", payload)
                  : undefined,
                onRowFailure: this.eventOptions.emitRowEvents
                  ? (payload) => this.safeEmit("rowFailure", payload)
                  : undefined,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`Warning: Could not process ${configPath}: ${message}`);
            }
          }
        });

        await Promise.allSettled(entityPromises);
      }
    }
  }

  /**
   * Utility function to chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    if (chunkSize <= 0) return [array];
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
