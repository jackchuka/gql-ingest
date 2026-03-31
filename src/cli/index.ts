import { Command } from "commander";
import { globSync } from "tinyglobby";
import { GQLIngest } from "../lib/gql-ingest";
import { createConsoleLogger, noopLogger } from "../lib/logger";
import { registerInitCommand } from "./commands/init";
import { registerAddCommand } from "./commands/add";

const GLOB_CHARS = /[*?{}[\]]/;

function resolveEntityFiles(patterns: string[]): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (GLOB_CHARS.test(pattern)) {
      files.push(...globSync(pattern));
    } else {
      files.push(pattern);
    }
  }
  return [...new Set(files)];
}

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
  .argument(
    "[entityFiles...]",
    "Entity file paths (JSON files defining data source, mutation, and field mapping)",
  )
  .option("-e, --endpoint <url>", "GraphQL endpoint URL")
  .option(
    "-c, --config <path>",
    "Path to config.yaml for retry, parallelism, and dependency settings",
  )
  .option(
    "-n, --entities <entities>",
    "Comma-separated list of specific entities to process (filters positional entity files by name)",
  )
  .option("-h, --headers <headers>", "JSON string of headers to include in requests")
  .option("-q, --quiet", "Suppress logging output")
  .option("-f, --format <format>", "Override data format detection (csv, json, yaml, jsonl)")
  .action(async (entityFilePatterns: string[], options) => {
    if (!options.endpoint || entityFilePatterns.length === 0) {
      program.help();
      return;
    }

    const logger = options.quiet ? noopLogger : createConsoleLogger();

    try {
      const entityFiles = resolveEntityFiles(entityFilePatterns);
      if (entityFiles.length === 0) {
        logger.error("No entity files matched the provided patterns");
        process.exit(1);
      }

      logger.info("Starting seed data generation...");

      const headers = options.headers ? JSON.parse(options.headers) : {};

      const client = new GQLIngest({
        endpoint: options.endpoint,
        headers: headers,
        logger: logger,
        formatOverride: options.format,
      });

      const entities = options.entities
        ? options.entities.split(",").map((e: string) => e.trim())
        : undefined;

      const result = await client.ingest(entityFiles, {
        config: options.config,
        entities,
      });

      logger.info(client.getMetricsSummary());

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      logger.error("Error:", error);
      process.exit(1);
    }
  });

program.parse();
