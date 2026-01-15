/**
 * Event-based progress monitoring example
 *
 * This example demonstrates how to use the EventEmitter-based API
 * to track ingestion progress in real-time, handle cancellation,
 * and respond to success/failure events.
 */

import {
  GQLIngest,
  StartedEventPayload,
  ProgressEventPayload,
  EntityStartEventPayload,
  EntityCompleteEventPayload,
  RowSuccessEventPayload,
  RowFailureEventPayload,
  CancelledEventPayload,
  FinishedEventPayload,
  ErroredEventPayload,
} from "@jackchuka/gql-ingest";

async function main() {
  // Initialize the client with event options
  const client = new GQLIngest({
    endpoint: "https://your-graphql-api.com/graphql",
    headers: {
      Authorization: "Bearer YOUR_TOKEN",
    },
    eventOptions: {
      emitRowEvents: true, // Emit events for each row (can be verbose)
      emitProgressEvents: true, // Emit periodic progress events
      progressInterval: 1000, // Progress event every 1 second
    },
  });

  // Track progress with a simple progress bar
  let progressBar = "";

  // === Event Listeners ===

  // Fired when ingestion starts
  client.on("started", (payload: StartedEventPayload) => {
    console.log("\n========================================");
    console.log(`Starting ingestion: ${payload.configPath}`);
    console.log(`Entities to process: ${payload.entityNames.join(", ")}`);
    console.log(`Total entities: ${payload.totalEntities}`);
    console.log(`Dependency waves: ${payload.totalWaves}`);
    console.log("========================================\n");
  });

  // Fired periodically during processing
  client.on("progress", (payload: ProgressEventPayload) => {
    const percent = payload.progressPercent.toFixed(1);
    const barLength = Math.floor(payload.progressPercent / 5);
    progressBar = "=".repeat(barLength).padEnd(20, " ");

    process.stdout.write(
      `\r[${progressBar}] ${percent}% | ` +
        `Rows: ${payload.rowsProcessed} | ` +
        `Success: ${payload.successfulRows} | ` +
        `Failed: ${payload.failedRows} | ` +
        `Elapsed: ${(payload.elapsedMs / 1000).toFixed(1)}s`,
    );
  });

  // Fired when an entity starts processing
  client.on("entityStart", (payload: EntityStartEventPayload) => {
    console.log(`\n-> Starting entity: ${payload.entityName} (${payload.totalRows} rows)`);
  });

  // Fired when an entity completes
  client.on("entityComplete", (payload: EntityCompleteEventPayload) => {
    const status = payload.success ? "SUCCESS" : "PARTIAL";
    console.log(
      `<- Completed: ${payload.entityName} [${status}] - ` +
        `${payload.metrics.successfulRows}/${payload.metrics.rowsProcessed} rows ` +
        `in ${payload.durationMs}ms`,
    );
  });

  // Fired for each successful row (optional, can be verbose)
  client.on("rowSuccess", (payload: RowSuccessEventPayload) => {
    // Only log every 100th row to avoid spam
    if (payload.rowIndex % 100 === 0) {
      console.log(
        `   [${payload.entityName}] Row ${payload.rowIndex}: OK (${payload.durationMs}ms)`,
      );
    }
  });

  // Fired for each failed row
  client.on("rowFailure", (payload: RowFailureEventPayload) => {
    console.error(
      `   [${payload.entityName}] Row ${payload.rowIndex} FAILED: ${payload.error.message}`,
    );
  });

  // Fired when processing is cancelled
  client.on("cancelled", (payload: CancelledEventPayload) => {
    console.log("\n\n========================================");
    console.log(`CANCELLED: ${payload.reason}`);
    console.log(`Processed ${payload.metrics.totalRows} rows before cancellation`);
    console.log(`Elapsed time: ${payload.elapsedMs}ms`);
    console.log("========================================\n");
  });

  // Fired when processing completes successfully
  client.on("finished", (payload: FinishedEventPayload) => {
    console.log("\n\n========================================");
    console.log("INGESTION COMPLETE");
    console.log(`Total rows: ${payload.metrics.totalRows}`);
    console.log(`Successful: ${payload.metrics.successfulOperations}`);
    console.log(`Failed: ${payload.metrics.failedOperations}`);
    console.log(`Duration: ${payload.durationMs}ms`);
    console.log(`All successful: ${payload.allSuccessful ? "Yes" : "No"}`);
    console.log("========================================\n");
  });

  // Fired when a fatal error occurs
  client.on("errored", (payload: ErroredEventPayload) => {
    console.error("\n\n========================================");
    console.error("FATAL ERROR");
    console.error(`Error: ${payload.error.message}`);
    console.error(`Current entity: ${payload.currentEntity || "N/A"}`);
    console.error(`Elapsed time: ${payload.elapsedMs}ms`);
    console.error("========================================\n");
  });

  // === Handle graceful shutdown ===
  process.on("SIGINT", () => {
    console.log("\n\nReceived SIGINT, cancelling ingestion...");
    client.cancel("User interrupted (Ctrl+C)");
  });

  process.on("SIGTERM", () => {
    console.log("\n\nReceived SIGTERM, cancelling ingestion...");
    client.cancel("Process terminated");
  });

  // === Run ingestion ===
  try {
    const result = await client.ingest("./config");

    if (result.cancelled) {
      console.log("Ingestion was cancelled");
      process.exit(1);
    }

    if (!result.success) {
      console.error("Ingestion failed:", result.errors);
      process.exit(1);
    }

    console.log("Ingestion completed successfully!");
  } catch (error) {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
}

// === Example with external AbortController ===
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function withAbortController() {
  const client = new GQLIngest({
    endpoint: "https://your-graphql-api.com/graphql",
  });

  // Create an external abort controller
  const controller = new AbortController();

  // Set up a timeout to cancel after 5 minutes
  const timeout = setTimeout(
    () => {
      console.log("Timeout reached, cancelling...");
      controller.abort("Timeout exceeded");
    },
    5 * 60 * 1000,
  );

  client.on("finished", () => {
    clearTimeout(timeout);
  });

  const result = await client.ingest("./config", {
    signal: controller.signal,
  });

  clearTimeout(timeout);
  return result;
}

// === Example: Disable verbose row events ===
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function withMinimalEvents() {
  const client = new GQLIngest({
    endpoint: "https://your-graphql-api.com/graphql",
    eventOptions: {
      emitRowEvents: false, // Don't emit rowSuccess/rowFailure events
      emitProgressEvents: true,
      progressInterval: 2000, // Progress every 2 seconds
    },
  });

  // Only listen to high-level events
  client.on("started", (p) => console.log(`Starting ${p.totalEntities} entities`));
  client.on("entityComplete", (p) =>
    console.log(`${p.entityName}: ${p.metrics.successfulRows} rows`),
  );
  client.on("finished", (p) => console.log(`Done in ${p.durationMs}ms`));

  return client.ingest("./config");
}

// Run the main example
main().catch(console.error);
