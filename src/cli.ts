import { Command } from "commander";
import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper } from "./mapper";
import { MetricsCollector } from "./metrics";
import { loadConfig, getEntityConfig, getRetryConfig } from "./config";
import { DependencyResolver } from "./dependency-resolver";
import { basename } from "path";

// Utility function to chunk array into smaller arrays
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [array];
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

const program = new Command();

program
  .name("gql-ingest")
  .description(
    "A CLI tool for ingesting data from files into a GraphQL API. Supports CSV, JSON, JSONL, and YAML file formats.",
  )
  .version(require("../package.json").version);

program
  .requiredOption("-e, --endpoint <url>", "GraphQL endpoint URL")
  .requiredOption(
    "-c, --config <path>",
    "Path to configuration directory (containing data/, graphql/, mappings/ subdirectories)",
  )
  .option(
    "-n, --entities <entities>",
    "Comma-separated list of specific entities to process (e.g., users,products)",
  )
  .option("-h, --headers <headers>", "JSON string of headers to include in requests")
  .option("-v, --verbose", "Show detailed request results and responses")
  .option("-f, --format <format>", "Override data format detection (csv, json, yaml, jsonl)")
  .action(async (options) => {
    try {
      console.log("Starting seed data generation...");

      // Parse headers if provided
      const headers = options.headers ? JSON.parse(options.headers) : {};

      // Initialize metrics collector
      const metrics = new MetricsCollector();

      // Initialize GraphQL client
      const client = new GraphQLClientWrapper(options.endpoint, headers, metrics, options.verbose);

      // Load configuration
      const config = loadConfig(options.config);

      // Initialize data mapper
      const mapper = new DataMapper(
        client,
        process.cwd(),
        metrics,
        options.verbose,
        options.format,
      );

      // Parse entities filter if provided
      const entityFilter = options.entities
        ? options.entities.split(",").map((e: string) => e.trim())
        : undefined;

      // Discover all mapping files dynamically
      const mappingPaths = mapper.discoverMappings(options.config, entityFilter);

      if (mappingPaths.length === 0) {
        const filterMsg = entityFilter ? ` matching entities: ${entityFilter.join(", ")}` : "";
        console.warn(`No mapping files found in ${options.config}/mappings${filterMsg}`);
        return;
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
        !!entityFilter, // Allow partial resolution when using --entities
      );

      // Validate dependencies
      const validationErrors = resolver.validateDependencies();
      if (validationErrors.length > 0) {
        if (entityFilter) {
          // When using --entities flag, show warnings instead of errors
          console.warn("\n⚠️  Warning: Dependency validation issues:");
          validationErrors.forEach((error) => console.warn(`  - ${error}`));
          console.warn("This may cause errors if the dependent data doesn't already exist.\n");
        } else {
          // Strict validation when processing all entities
          console.error("Dependency validation errors:");
          validationErrors.forEach((error) => console.error(`  - ${error}`));
          process.exit(1);
        }
      }

      await processEntitiesInWaves(mappingPaths, resolver, mapper, config);

      metrics.finishProcessing();
      console.log(metrics.generateSummary());
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

async function processEntitiesInWaves(
  mappingPaths: string[],
  resolver: DependencyResolver,
  mapper: DataMapper,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const waves = resolver.resolveExecutionOrder();
  const pathMap = new Map(mappingPaths.map((path) => [basename(path, ".json"), path]));

  console.log(`Processing ${waves.length} dependency waves...`);

  for (const wave of waves) {
    console.log(`Wave ${wave.wave + 1}: Processing entities [${wave.entities.join(", ")}]`);

    // Process entities in controlled batches based on entityConcurrency
    const entityConcurrency = config.parallelProcessing.entityConcurrency;
    const chunks = chunkArray(wave.entities, entityConcurrency);

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

program.parse();
