import { Command } from "commander";
import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper } from "./mapper";

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
  .action(async (options) => {
    try {
      console.log("Starting seed data generation...");

      // Parse headers if provided
      const headers = options.headers ? JSON.parse(options.headers) : {};

      // Initialize GraphQL client
      const client = new GraphQLClientWrapper(options.endpoint, headers);

      // Initialize data mapper
      const mapper = new DataMapper(client);

      // Discover all mapping files dynamically
      const mappingPaths = mapper.discoverMappings(options.config);

      if (mappingPaths.length === 0) {
        console.warn(`No mapping files found in ${options.config}/mappings`);
        return;
      }

      for (const configPath of mappingPaths) {
        try {
          await mapper.processEntity(configPath);
        } catch (error) {
          console.warn(`Warning: Could not process ${configPath}:`, error);
        }
      }

      console.log("Seed data generation completed!");
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program.parse();
