import { Command } from "commander";
import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper } from "./mapper";
import { MetricsCollector } from "./metrics";
import { loadConfig, getEntityConfig } from "./config";
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
    "A CLI tool for ingesting data from CSV files into a GraphQL API"
  )
  .version(require("../package.json").version);

program
  .requiredOption("-e, --endpoint <url>", "GraphQL endpoint URL")
  .requiredOption(
    "-c, --config <path>",
    "Path to configuration directory (containing data/, graphql/, mappings/ subdirectories)"
  )
  .option(
    "-h, --headers <headers>",
    "JSON string of headers to include in requests"
  )
  .option("-v, --verbose", "Show detailed request results and responses")
  .action(async (options) => {
    try {
      console.log("Starting seed data generation...");

      // Parse headers if provided
      const headers = options.headers ? JSON.parse(options.headers) : {};

      // Initialize metrics collector
      const metrics = new MetricsCollector();

      // Initialize GraphQL client
      const client = new GraphQLClientWrapper(
        options.endpoint,
        headers,
        metrics,
        options.verbose
      );

      // Load configuration
      const config = loadConfig(options.config);

      // Initialize data mapper
      const mapper = new DataMapper(
        client,
        process.cwd(),
        metrics,
        options.verbose
      );

      // Discover all mapping files dynamically
      const mappingPaths = mapper.discoverMappings(options.config);

      if (mappingPaths.length === 0) {
        console.warn(`No mapping files found in ${options.config}/mappings`);
        return;
      }

      // Extract entity names from mapping paths
      const entityNames = mappingPaths.map((path) => basename(path, ".json"));

      // Setup dependency resolver
      const resolver = new DependencyResolver(
        entityNames,
        config.entityDependencies
      );

      // Validate dependencies
      const validationErrors = resolver.validateDependencies();
      if (validationErrors.length > 0) {
        console.error("Dependency validation errors:");
        validationErrors.forEach((error) => console.error(`  - ${error}`));
        process.exit(1);
      }

      // Process entities in dependency-aware waves
      if (config.parallelProcessing.entityConcurrency === 1) {
        await processEntitiesSequentially(mappingPaths, mapper, config);
      } else {
        await processEntitiesInWaves(mappingPaths, resolver, mapper, config);
      }

      metrics.finishProcessing();
      console.log(metrics.generateSummary());
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

async function processEntitiesSequentially(
  mappingPaths: string[],
  mapper: DataMapper,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  for (const configPath of mappingPaths) {
    try {
      const entityName = basename(configPath, ".json");
      const entityConfig = getEntityConfig(entityName, config);
      await mapper.processEntity(configPath, entityConfig);
    } catch (error) {
      console.warn(`Warning: Could not process ${configPath}:`, error);
    }
  }
}

async function processEntitiesInWaves(
  mappingPaths: string[],
  resolver: DependencyResolver,
  mapper: DataMapper,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const waves = resolver.resolveExecutionOrder();
  const pathMap = new Map(
    mappingPaths.map((path) => [basename(path, ".json"), path])
  );

  console.log(`Processing ${waves.length} dependency waves...`);

  for (const wave of waves) {
    console.log(
      `Wave ${wave.wave + 1}: Processing entities [${wave.entities.join(", ")}]`
    );

    // Process entities in controlled batches based on entityConcurrency
    const entityConcurrency = config.parallelProcessing.entityConcurrency;
    const chunks = chunkArray(wave.entities, entityConcurrency);
    
    for (const chunk of chunks) {
      const entityPromises = chunk.map(async (entityName) => {
        const configPath = pathMap.get(entityName);
        if (configPath) {
          try {
            const entityConfig = getEntityConfig(entityName, config);
            await mapper.processEntity(configPath, entityConfig);
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
