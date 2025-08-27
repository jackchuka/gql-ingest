/**
 * Basic usage example of gql-ingest programmatic API
 *
 * This example shows how to use the simple API to ingest data
 * from a configuration directory into a GraphQL API.
 */

import { GQLIngest } from "@jackchuka/gql-ingest";

async function main() {
  // Initialize the GQL Ingest client
  const client = new GQLIngest({
    endpoint: "https://your-graphql-api.com/graphql",
    headers: {
      Authorization: "Bearer YOUR_TOKEN",
      "Content-Type": "application/json",
    },
    verbose: false, // Set to true for detailed logging
  });

  try {
    // Example 1: Ingest all data from a configuration
    console.log("Starting full data ingestion...");
    const fullResult = await client.ingest("./config");

    if (fullResult.success) {
      console.log("✅ Full ingestion completed successfully");
      console.log("Metrics:", fullResult.metrics);
    } else {
      console.error("❌ Full ingestion failed:", fullResult.errors);
    }

    // Example 2: Process only specific entities
    console.log("\nProcessing specific entities...");
    const partialResult = await client.ingestEntities("./config", [
      "users",
      "products",
    ]);

    if (partialResult.success) {
      console.log("✅ Partial ingestion completed successfully");

      // Get a formatted summary of the metrics
      console.log(client.getMetricsSummary());
    } else {
      console.error("❌ Partial ingestion failed:", partialResult.errors);
    }

    // Example 3: Using options for more control
    console.log("\nIngesting with custom options...");
    const customResult = await client.ingest("./config", {
      entities: ["orders", "order_items"],
      verbose: true, // Override verbose setting for this operation
      format: "csv", // Force CSV format detection
    });

    if (customResult.success) {
      console.log("✅ Custom ingestion completed successfully");

      // Access detailed metrics
      const metrics = client.getMetrics();
      console.log(`Total rows processed: ${metrics.totalRows}`);
      console.log(`Successful operations: ${metrics.successfulOperations}`);
      console.log(`Failed operations: ${metrics.failedOperations}`);
      console.log(`Total duration: ${metrics.totalDuration}ms`);
    }
  } catch (error) {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
