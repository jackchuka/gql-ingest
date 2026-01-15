import { Command } from "commander";
import { GQLIngest } from "../lib/gql-ingest";
import { createConsoleLogger, noopLogger } from "../lib/logger";
import { registerInitCommand } from "./commands/init";
import { registerAddCommand } from "./commands/add";

const program = new Command();

program
  .name("gql-ingest")
  .description(
    "A CLI tool for ingesting data from files into a GraphQL API. Supports CSV, JSON, JSONL, and YAML file formats.",
  )
  .version(require("../../package.json").version)
  .enablePositionalOptions();

// Register scaffolding subcommands
registerInitCommand(program);
registerAddCommand(program);

// Main ingest options on root command
program
  .option("-e, --endpoint <url>", "GraphQL endpoint URL")
  .option(
    "-c, --config <path>",
    "Path to configuration directory (containing data/, graphql/, mappings/ subdirectories)",
  )
  .option(
    "-n, --entities <entities>",
    "Comma-separated list of specific entities to process (e.g., users,products)",
  )
  .option("-h, --headers <headers>", "JSON string of headers to include in requests")
  .option("-q, --quiet", "Suppress logging output")
  .option("-f, --format <format>", "Override data format detection (csv, json, yaml, jsonl)")
  .action(async (options) => {
    // Only run ingest if endpoint and config are provided
    if (!options.endpoint || !options.config) {
      // No ingest options provided, show help
      program.help();
      return;
    }

    const logger = options.quiet ? noopLogger : createConsoleLogger();

    try {
      logger.info("Starting seed data generation...");

      // Parse headers if provided
      const headers = options.headers ? JSON.parse(options.headers) : {};

      // Initialize GQLIngest client
      const client = new GQLIngest({
        endpoint: options.endpoint,
        headers: headers,
        logger: logger,
        formatOverride: options.format,
      });

      // Perform ingestion
      const result = await client.ingest(options.config, {
        entities: options.entities,
      });

      // Display metrics summary
      logger.info(client.getMetricsSummary());

      // Exit with appropriate code
      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      logger.error("Error:", error);
      process.exit(1);
    }
  });

program.parse();
