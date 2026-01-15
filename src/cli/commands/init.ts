import { Command } from "commander";
import path from "path";
import { createConsoleLogger, noopLogger } from "../../lib/logger";
import { generateExampleEntity, generateConfigYaml, ensureDirectories } from "../templates";

interface InitOptions {
  example: boolean;
  config: boolean;
  force: boolean;
  quiet: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init [path]")
    .description("Initialize a new gql-ingest configuration directory")
    .option("--no-example", "Skip creating example entity files")
    .option("--no-config", "Skip creating config.yaml")
    .option("-f, --force", "Overwrite existing files", false)
    .option("-q, --quiet", "Suppress output", false)
    .action(async (targetPath: string | undefined, options: InitOptions) => {
      const logger = options.quiet ? noopLogger : createConsoleLogger();
      const resolvedPath = path.resolve(targetPath || process.cwd());

      try {
        // Create directories
        ensureDirectories(resolvedPath, logger);

        // Create config.yaml if requested (default: true)
        if (options.config) {
          await generateConfigYaml(resolvedPath, options.force, logger);
        }

        // Create example entity if requested (default: true)
        if (options.example) {
          await generateExampleEntity(resolvedPath, options.force, logger);
        }

        logger.info("");
        logger.info(`Initialized gql-ingest configuration at: ${resolvedPath}`);
        logger.info("");
        logger.info("Next steps:");
        logger.info("  1. Edit data files in data/");
        logger.info("  2. Define GraphQL mutations in graphql/");
        logger.info("  3. Configure mappings in mappings/");
        logger.info(`  4. Run: gql-ingest -e <endpoint> -c ${resolvedPath}`);
      } catch (error) {
        logger.error("Error initializing configuration:", error);
        process.exit(1);
      }
    });
}
