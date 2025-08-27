import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper, MappingConfig } from "./mapper";
import { MetricsCollector, ProcessingMetrics } from "./metrics";
import { DependencyResolver, ExecutionWave } from "./dependency-resolver";
import {
  loadConfig,
  getEntityConfig,
  getRetryConfig,
  ProcessingConfig,
  ParallelProcessingConfig,
  RetryConfig,
} from "./config";
import { basename } from "path";

/**
 * Options for initializing GQLIngest client
 */
export interface GQLIngestOptions {
  /** GraphQL endpoint URL */
  endpoint: string;
  /** Optional headers to include in GraphQL requests */
  headers?: Record<string, string>;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Override data format detection (csv, json, yaml, jsonl) */
  formatOverride?: string;
}

/**
 * Options for ingesting data
 */
export interface IngestOptions {
  /** Comma-separated list or array of specific entities to process */
  entities?: string[] | string;
  /** Enable verbose logging for this operation */
  verbose?: boolean;
  /** Override data format detection for this operation */
  format?: string;
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
}

/**
 * Main class for programmatic access to gql-ingest functionality
 */
export class GQLIngest {
  private endpoint: string;
  private headers: Record<string, string>;
  private verbose: boolean;
  private formatOverride?: string;
  private metrics: MetricsCollector;
  private client: GraphQLClientWrapper;
  private mapper: DataMapper;

  constructor(options: GQLIngestOptions) {
    this.endpoint = options.endpoint;
    this.headers = options.headers || {};
    this.verbose = options.verbose || false;
    this.formatOverride = options.formatOverride;

    // Initialize components
    this.metrics = new MetricsCollector();
    this.client = new GraphQLClientWrapper(
      this.endpoint,
      this.headers,
      this.metrics,
      this.verbose
    );
    this.mapper = new DataMapper(
      this.client,
      process.cwd(),
      this.metrics,
      this.verbose,
      this.formatOverride
    );
  }

  /**
   * Ingest data from a configuration directory
   * @param configPath Path to configuration directory (containing data/, graphql/, mappings/ subdirectories)
   * @param options Optional ingestion options
   * @returns Promise with ingestion result
   */
  async ingest(
    configPath: string,
    options?: IngestOptions
  ): Promise<IngestResult> {
    const errors: string[] = [];

    try {
      // Reset metrics for new operation
      this.metrics = new MetricsCollector();

      // Update client and mapper with new metrics
      this.client = new GraphQLClientWrapper(
        this.endpoint,
        this.headers,
        this.metrics,
        options?.verbose ?? this.verbose
      );

      this.mapper = new DataMapper(
        this.client,
        process.cwd(),
        this.metrics,
        options?.verbose ?? this.verbose,
        options?.format ?? this.formatOverride
      );

      // Load configuration
      const config = loadConfig(configPath);

      // Parse entities filter if provided
      let entityFilter: string[] | undefined;
      if (options?.entities) {
        if (typeof options.entities === "string") {
          entityFilter = options.entities
            .split(",")
            .map((e: string) => e.trim());
        } else {
          entityFilter = options.entities;
        }
      }

      // Discover all mapping files dynamically
      const mappingPaths = this.mapper.discoverMappings(
        configPath,
        entityFilter
      );

      if (mappingPaths.length === 0) {
        const filterMsg = entityFilter
          ? ` matching entities: ${entityFilter.join(", ")}`
          : "";
        const warning = `No mapping files found in ${configPath}/mappings${filterMsg}`;
        console.warn(warning);
        return {
          metrics: this.metrics.getMetrics(),
          success: false,
          errors: [warning],
        };
      }

      // Extract entity names from mapping paths
      const entityNames = mappingPaths.map((path) => basename(path, ".json"));

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
        !!entityFilter // Allow partial resolution when using --entities
      );

      // Validate dependencies
      const validationErrors = resolver.validateDependencies();
      if (validationErrors.length > 0) {
        if (entityFilter) {
          // When using entities filter, show warnings instead of errors
          console.warn("\\n⚠️  Warning: Dependency validation issues:");
          validationErrors.forEach((error) => console.warn(`  - ${error}`));
          console.warn(
            "This may cause errors if the dependent data doesn't already exist.\\n"
          );
        } else {
          // Strict validation when processing all entities
          console.error("Dependency validation errors:");
          validationErrors.forEach((error) => {
            console.error(`  - ${error}`);
            errors.push(error);
          });
          return {
            metrics: this.metrics.getMetrics(),
            success: false,
            errors,
          };
        }
      }

      // Process entities
      await this.processEntitiesInWaves(
        mappingPaths,
        resolver,
        this.mapper,
        config
      );

      this.metrics.finishProcessing();

      return {
        metrics: this.metrics.getMetrics(),
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error:", errorMessage);
      errors.push(errorMessage);

      return {
        metrics: this.metrics.getMetrics(),
        success: false,
        errors,
      };
    }
  }

  /**
   * Ingest specific entities from a configuration directory
   * @param configPath Path to configuration directory
   * @param entities Array of entity names to process
   * @returns Promise with ingestion result
   */
  async ingestEntities(
    configPath: string,
    entities: string[]
  ): Promise<IngestResult> {
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
   * Set verbose mode
   * @param verbose Enable or disable verbose mode
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
    this.client = new GraphQLClientWrapper(
      this.endpoint,
      this.headers,
      this.metrics,
      verbose
    );
    this.mapper = new DataMapper(
      this.client,
      process.cwd(),
      this.metrics,
      verbose,
      this.formatOverride
    );
  }

  /**
   * Update headers for GraphQL requests
   * @param headers New headers to use
   */
  setHeaders(headers: Record<string, string>): void {
    this.headers = headers;
    this.client = new GraphQLClientWrapper(
      this.endpoint,
      headers,
      this.metrics,
      this.verbose
    );
    this.mapper = new DataMapper(
      this.client,
      process.cwd(),
      this.metrics,
      this.verbose,
      this.formatOverride
    );
  }

  /**
   * Process entities in dependency-aware waves
   */
  private async processEntitiesInWaves(
    mappingPaths: string[],
    resolver: DependencyResolver,
    mapper: DataMapper,
    config: ProcessingConfig
  ): Promise<void> {
    const waves = resolver.resolveExecutionOrder();
    const pathMap = new Map(
      mappingPaths.map((path) => [basename(path, ".json"), path])
    );

    console.log(`Processing ${waves.length} dependency waves...`);

    for (const wave of waves) {
      console.log(
        `Wave ${wave.wave + 1}: Processing entities [${wave.entities.join(
          ", "
        )}]`
      );

      // Process entities in controlled batches based on entityConcurrency
      const entityConcurrency = config.parallelProcessing.entityConcurrency;
      const chunks = this.chunkArray(wave.entities, entityConcurrency);

      for (const chunk of chunks) {
        const entityPromises = chunk.map(async (entityName) => {
          const configPath = pathMap.get(entityName);
          if (configPath) {
            try {
              const entityConfig = getEntityConfig(entityName, config);
              const retryConfig = getRetryConfig(entityName, config);
              await mapper.processEntity(configPath, entityConfig, retryConfig);
            } catch (error) {
              console.warn(`Warning: Could not process ${configPath}:`, error);
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
