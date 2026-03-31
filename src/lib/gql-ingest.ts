import { EventEmitter } from "events";
import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper, OutputStore } from "./mapper";
import { MetricsCollector, ProcessingMetrics } from "./metrics";
import { DependencyResolver } from "./dependency-resolver";
import { loadConfig, getEntityConfig, getRetryConfig, Config } from "./config";
import { Logger, noopLogger } from "./logger";
import fs from "fs";
import path from "path";
import { MappingConfig } from "./mapper";
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
  /** Path to config.yaml for retry/parallelism/dependency settings */
  config?: string;
  /** Override data format detection for this operation */
  format?: string;
  /** Filter to only process entities with these names */
  entities?: string[];
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
export class GQLIngest extends EventEmitter<GQLIngestEventMap> {
  private endpoint: string;
  private headers: Record<string, string>;
  private logger: Logger;
  private formatOverride?: string;
  private metrics: MetricsCollector;
  private client: GraphQLClientWrapper;
  private mapper: DataMapper;
  private eventOptions: Required<EventOptions>;

  private outputStore: OutputStore = new Map();

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
  private safeEmit<const K extends keyof GQLIngestEventMap>(
    event: K,
    ...payload: GQLIngestEventMap[K]
  ): boolean {
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      return this.emit(event, ...(payload as any));
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
   * Ingest entity files
   * @param entityFiles Array of paths to entity JSON mapping files
   * @param options Optional ingestion options
   * @returns Promise with ingestion result
   */
  async ingest(entityFiles: string[], options?: IngestOptions): Promise<IngestResult> {
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

      // Reset state for new operation
      this.metrics = new MetricsCollector();
      this.outputStore = new Map();

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

      // Load configuration (optional)
      const config = loadConfig(options?.config, this.logger);

      if (entityFiles.length === 0) {
        const warning = "No entity files provided";
        this.logger.warn(warning);
        return {
          metrics: this.metrics.getMetrics(),
          success: false,
          errors: [warning],
        };
      }

      // Read entity names from files
      const entityFilter = options?.entities ? new Set(options.entities) : null;
      const entityNames: string[] = [];
      const pathMap = new Map<string, string>();
      for (const file of entityFiles) {
        const fullPath = path.resolve(process.cwd(), file);
        const entityConfig: MappingConfig = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (!entityConfig.name) {
          throw new Error(`Missing "name" field in entity file: ${file}`);
        }
        if (entityFilter && !entityFilter.has(entityConfig.name)) {
          continue;
        }
        entityNames.push(entityConfig.name);
        pathMap.set(entityConfig.name, file);
      }
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
      const resolver = new DependencyResolver(entityNames, relevantDependencies, false);

      // Validate dependencies
      const validationErrors = resolver.validateDependencies();
      if (validationErrors.length > 0) {
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

      const waves = resolver.resolveExecutionOrder();
      this.totalWaves = waves.length;

      // Emit started event
      const startedPayload: StartedEventPayload = {
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
        pathMap,
        resolver,
        this.mapper,
        config,
        this.logger,
        signal,
        this.outputStore,
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
    pathMap: Map<string, string>,
    resolver: DependencyResolver,
    mapper: DataMapper,
    config: Config,
    logger: Logger,
    signal?: AbortSignal,
    outputStore?: OutputStore,
  ): Promise<void> {
    const waves = resolver.resolveExecutionOrder();

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
              await mapper.processEntityWithEvents(
                configPath,
                entityConfig,
                retryConfig,
                signal,
                {
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
                },
                outputStore,
              );
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
