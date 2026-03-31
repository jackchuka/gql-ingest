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
import { basename, dirname } from "path";

async function customIngestionPipeline() {
  const endpoint = "https://your-graphql-api.com/graphql";
  const headers = {
    Authorization: "Bearer YOUR_TOKEN",
  };

  // Entity files to process (colocated layout)
  const entityFiles = ["./users/entity.json", "./products/entity.json"];

  // Step 1: Initialize components
  console.log("Initializing components...");
  const metrics = new MetricsCollector();
  const client = new GraphQLClientWrapper(endpoint, headers, metrics, true);
  const mapper = new DataMapper(client, process.cwd(), metrics, true);

  // Step 2: Load configuration for retry/parallelism settings
  console.log("Loading configuration...");
  const config = loadConfig("./config.yaml");

  // Step 3: Extract entity names from file paths
  const entityNames = entityFiles.map((path) => basename(dirname(path)));
  console.log(`Processing ${entityFiles.length} entity files`);

  const dependencies = {};
  if (config.entityDependencies) {
    for (const entity of entityNames) {
      if (config.entityDependencies[entity]) {
        dependencies[entity] = config.entityDependencies[entity];
      }
    }
  }

  // Step 4: Resolve execution order
  const resolver = new DependencyResolver(entityNames, dependencies);
  const validationErrors = resolver.validateDependencies();

  if (validationErrors.length > 0) {
    console.error("Dependency validation errors:", validationErrors);
    return;
  }

  const waves = resolver.resolveExecutionOrder();
  console.log(`Will process entities in ${waves.length} waves`);

  // Step 5: Custom processing logic
  for (const wave of waves) {
    console.log(`\nWave ${wave.wave + 1}: ${wave.entities.join(", ")}`);

    // Process entities with custom error handling and logging
    for (const entityName of wave.entities) {
      const entityFile = entityFiles.find((p) => basename(dirname(p)) === entityName);

      if (!entityFile) continue;

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
        await mapper.processEntity(entityFile, entityConfig, retryConfig);

        // Custom post-processing
        const entityMetrics = metrics.getEntityMetrics(entityName);
        console.log(`  Completed: ${entityMetrics.rowsProcessed} rows`);
      } catch (error) {
        console.error(`  Failed to process ${entityName}:`, error.message);
      }
    }
  }

  // Step 6: Finalize and report
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

  async ingestWithValidation(entityFiles, validator) {
    // Custom validation before processing
    const isValid = await validator.validate(entityFiles);
    if (!isValid) {
      throw new Error("Validation failed");
    }

    // Continue with normal processing...
    const config = loadConfig("./config.yaml");
    // ... rest of the ingestion logic
  }

  async ingestWithTransform(entityFiles, transformer) {
    // Custom data transformation during processing
    // This would require extending the DataMapper class
    // to support transformation hooks
  }
}

// Run the example
customIngestionPipeline().catch(console.error);
