// oxlint-disable no-unused-vars
/**
 * Advanced usage example of gql-ingest programmatic API
 *
 * This example demonstrates how to use the lower-level components
 * directly for more control over the ingestion process.
 */

import {
  GraphQLClientWrapper,
  DataMapper,
  DependencyResolver,
  MetricsCollector,
  loadConfig,
  getEntityConfig,
  getRetryConfig,
} from "@jackchuka/gql-ingest";
import { basename } from "path";

async function customIngestionPipeline() {
  const endpoint = "https://your-graphql-api.com/graphql";
  const headers = {
    Authorization: "Bearer YOUR_TOKEN",
  };
  const configPath = "./config";

  // Step 1: Initialize components
  console.log("Initializing components...");
  const metrics = new MetricsCollector();
  const client = new GraphQLClientWrapper(endpoint, headers, metrics, true);
  const mapper = new DataMapper(client, process.cwd(), metrics, true);

  // Step 2: Load and validate configuration
  console.log("Loading configuration...");
  const config = loadConfig(configPath);

  // Step 3: Discover available mappings
  const mappingPaths = mapper.discoverMappings(configPath);
  console.log(`Found ${mappingPaths.length} mapping files`);

  // Step 4: Extract entity names and set up dependencies
  const entityNames = mappingPaths.map((path) => basename(path, ".json"));

  const dependencies = {};
  if (config.entityDependencies) {
    for (const entity of entityNames) {
      if (config.entityDependencies[entity]) {
        dependencies[entity] = config.entityDependencies[entity];
      }
    }
  }

  // Step 5: Resolve execution order
  const resolver = new DependencyResolver(entityNames, dependencies);
  const validationErrors = resolver.validateDependencies();

  if (validationErrors.length > 0) {
    console.error("Dependency validation errors:", validationErrors);
    return;
  }

  const waves = resolver.resolveExecutionOrder();
  console.log(`Will process entities in ${waves.length} waves`);

  // Step 6: Custom processing logic
  for (const wave of waves) {
    console.log(`\nWave ${wave.wave + 1}: ${wave.entities.join(", ")}`);

    // Process entities with custom error handling and logging
    for (const entityName of wave.entities) {
      const mappingPath = mappingPaths.find((p) => basename(p, ".json") === entityName);

      if (!mappingPath) continue;

      try {
        console.log(`  Processing ${entityName}...`);
        metrics.startEntityProcessing(entityName);

        // Get entity-specific configuration
        const entityConfig = getEntityConfig(entityName, config);
        const retryConfig = getRetryConfig(entityName, config);

        // Custom pre-processing hook
        console.log(`  - Row concurrency: ${entityConfig.rowConcurrency}`);
        console.log(`  - Max retries: ${retryConfig.maxAttempts}`);

        // Process the entity
        await mapper.processEntity(mappingPath, entityConfig, retryConfig);

        // Custom post-processing
        const entityMetrics = metrics.getEntityMetrics(entityName);
        console.log(`  ✓ Completed: ${entityMetrics.rowsProcessed} rows`);

        // You could add custom logic here, like:
        // - Send notifications
        // - Update external systems
        // - Log to monitoring services
      } catch (error) {
        console.error(`  ✗ Failed to process ${entityName}:`, error.message);

        // Custom error recovery logic
        // You might want to:
        // - Retry with different settings
        // - Skip and continue
        // - Halt the entire process
      }
    }
  }

  // Step 7: Finalize and report
  metrics.finishProcessing();
  console.log("\n" + metrics.generateSummary());
}

// Example: Custom wrapper class extending functionality
class CustomGQLIngest {
  constructor(endpoint, headers) {
    this.metrics = new MetricsCollector();
    this.client = new GraphQLClientWrapper(endpoint, headers, this.metrics);
    this.mapper = new DataMapper(this.client, process.cwd(), this.metrics);
  }

  async ingestWithValidation(configPath, validator) {
    // Custom validation before processing
    const isValid = await validator.validate(configPath);
    if (!isValid) {
      throw new Error("Validation failed");
    }

    // Continue with normal processing...
    const config = loadConfig(configPath);
    // ... rest of the ingestion logic
  }

  async ingestWithTransform(configPath, transformer) {
    // Custom data transformation during processing
    // This would require extending the DataMapper class
    // to support transformation hooks
  }
}

// Run the example
customIngestionPipeline().catch(console.error);
