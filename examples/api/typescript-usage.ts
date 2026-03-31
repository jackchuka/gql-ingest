/**
 * TypeScript usage example of gql-ingest programmatic API
 *
 * This example demonstrates TypeScript usage with full type safety
 * and shows how to use the type definitions.
 */

import {
  GQLIngest,
  GQLIngestOptions,
  IngestOptions,
  IngestResult,
  ProcessingMetrics,
  EntityMetrics,
  createConsoleLogger,
} from "@jackchuka/gql-ingest";

// Example 1: Basic usage with type annotations
async function basicTypedUsage(): Promise<void> {
  // Define options with type safety
  const options: GQLIngestOptions = {
    endpoint: "https://your-graphql-api.com/graphql",
    headers: {
      Authorization: "Bearer YOUR_TOKEN",
    },
    logger: createConsoleLogger({ prefix: "gql-ingest" }),
    formatOverride: "csv",
  };

  const client = new GQLIngest(options);

  // Ingest with typed options
  const ingestOptions: IngestOptions = {
    config: "./config.yaml",
    format: "json",
  };

  const result: IngestResult = await client.ingest(
    ["./users/entity.json", "./products/entity.json"],
    ingestOptions,
  );

  // Type-safe access to result properties
  if (result.success) {
    const metrics: ProcessingMetrics = result.metrics;
    console.log(`Processed ${metrics.totalRows} rows`);
    console.log(`Success rate: ${(metrics.successfulOperations / metrics.totalRows) * 100}%`);

    // Access entity-specific metrics
    Object.entries(metrics.entities).forEach(([entity, entityMetrics]: [string, EntityMetrics]) => {
      console.log(`${entity}: ${entityMetrics.rowsProcessed} rows in ${entityMetrics.duration}ms`);
    });
  } else {
    // Type-safe error handling
    result.errors?.forEach((error: string) => {
      console.error(`Error: ${error}`);
    });
  }
}

// Example 2: Creating a custom typed service
class DataIngestionService {
  private client: GQLIngest;
  private readonly defaultOptions: IngestOptions;

  constructor(
    endpoint: string,
    private readonly apiKey: string,
  ) {
    this.client = new GQLIngest({
      endpoint,
      headers: {
        "X-API-Key": apiKey,
      },
    });

    this.defaultOptions = {
      config: "./config.yaml",
    };
  }

  async ingestUsers(): Promise<IngestResult> {
    return this.client.ingest(["./users/entity.json"], this.defaultOptions);
  }

  async ingestProducts(): Promise<IngestResult> {
    return this.client.ingest(["./products/entity.json"], this.defaultOptions);
  }

  async ingestWithRetry(entityFiles: string[], maxRetries: number = 3): Promise<IngestResult> {
    let lastResult: IngestResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`Attempt ${attempt} of ${maxRetries}`);

      lastResult = await this.client.ingest(entityFiles, this.defaultOptions);

      if (lastResult.success) {
        return lastResult;
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        await this.delay(1000 * attempt);
      }
    }

    return lastResult!;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getMetrics(): ProcessingMetrics {
    return this.client.getMetrics();
  }
}

// Example 3: Using with async/await error handling
async function robustIngestion(): Promise<void> {
  const service = new DataIngestionService("https://api.example.com/graphql", "your-api-key");

  try {
    // Ingest users with retry logic
    const userResult = await service.ingestWithRetry(["./users/entity.json"]);

    if (!userResult.success) {
      throw new Error(`Failed to ingest users: ${userResult.errors?.join(", ")}`);
    }

    // Ingest products
    const productResult = await service.ingestProducts();

    if (!productResult.success) {
      console.warn("Product ingestion failed, but continuing...");
    }

    // Get final metrics
    const metrics = service.getMetrics();
    generateReport(metrics);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Ingestion failed:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    process.exit(1);
  }
}

// Example 4: Custom type guards and utilities
function isSuccessfulResult(result: IngestResult): result is IngestResult & { success: true } {
  return result.success;
}

function generateReport(metrics: ProcessingMetrics): void {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalRows: metrics.totalRows,
      successful: metrics.successfulOperations,
      failed: metrics.failedOperations,
      duration: `${metrics.totalDuration}ms`,
      successRate: `${((metrics.successfulOperations / metrics.totalRows) * 100).toFixed(2)}%`,
    },
    entities: Object.entries(metrics.entities).map(([name, data]) => ({
      name,
      rows: data.rowsProcessed,
      successful: data.successfulRows,
      failed: data.failedRows,
      duration: `${data.duration}ms`,
    })),
  };

  console.log("Ingestion Report:", JSON.stringify(report, null, 2));
}

// Run examples
async function main(): Promise<void> {
  await basicTypedUsage();
  await robustIngestion();
}

main().catch(console.error);
