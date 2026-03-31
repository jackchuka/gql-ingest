/**
 * Basic usage example of gql-ingest programmatic API
 *
 * This example shows how to use the simple API to ingest data
 * from entity files into a GraphQL API.
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
  });

  try {
    // Example 1: Ingest all entity files
    console.log("Starting full data ingestion...");
    const fullResult = await client.ingest([
      "./users/users.json",
      "./products/products.json",
    ]);

    if (fullResult.success) {
      console.log("Full ingestion completed successfully");
      console.log("Metrics:", fullResult.metrics);
    } else {
      console.error("Full ingestion failed:", fullResult.errors);
    }

    // Example 2: Ingest a subset of entity files
    console.log("\nProcessing specific entities...");
    const partialResult = await client.ingest(["./users/users.json"]);

    if (partialResult.success) {
      console.log("Partial ingestion completed successfully");

      // Get a formatted summary of the metrics
      console.log(client.getMetricsSummary());
    } else {
      console.error("Partial ingestion failed:", partialResult.errors);
    }

    // Example 3: Using options for more control
    console.log("\nIngesting with custom options...");
    const customResult = await client.ingest(
      ["./orders/orders.json", "./order_items/order_items.json"],
      {
        config: "./config.yaml",
        format: "csv",
      },
    );

    if (customResult.success) {
      console.log("Custom ingestion completed successfully");

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
