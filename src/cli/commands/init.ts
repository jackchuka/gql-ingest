import { Command } from "commander";
import path from "path";
import { select } from "@inquirer/prompts";
import { createConsoleLogger, noopLogger } from "../../lib/logger";
import {
  generateExampleEntity,
  generateConfigYaml,
  ensureDirectories,
  DataFormat,
  isDataFormat,
  DATA_FORMAT_CHOICES,
  DEFAULT_DATA_FORMAT,
} from "../templates";

interface InitOptions {
  example: boolean;
  config: boolean;
  force: boolean;
  quiet: boolean;
  format?: string;
  interactive: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init [path]")
    .description("Initialize a new gql-ingest configuration directory")
    .option("--no-example", "Skip creating example entity files")
    .option("--no-config", "Skip creating config.yaml")
    .option("-f, --force", "Overwrite existing files", false)
    .option("-q, --quiet", "Suppress output", false)
    .option("--format <format>", "Data format for example entity (csv, json, yaml, jsonl)")
    .option("--no-interactive", "Skip prompts, use defaults only")
    .action(async (targetPath: string | undefined, options: InitOptions) => {
      const logger = options.quiet ? noopLogger : createConsoleLogger();
      const resolvedPath = path.resolve(targetPath || process.cwd());

      try {
        // Determine if interactive mode is available
        const isInteractive = options.interactive && process.stdin.isTTY;

        // Determine data format
        let format: DataFormat = DEFAULT_DATA_FORMAT;
        if (options.example) {
          if (isInteractive) {
            format = await select({
              message: "Select data format for example entity:",
              choices: DATA_FORMAT_CHOICES,
              default: DEFAULT_DATA_FORMAT,
            });
          } else if (options.format) {
            if (!isDataFormat(options.format)) {
              logger.error(
                `Invalid format. Must be one of: ${DATA_FORMAT_CHOICES.map((c) => c.value).join(", ")}`,
              );
              process.exit(1);
            }
            format = options.format;
          }
        }

        // Create directories
        ensureDirectories(resolvedPath, logger);

        // Create config.yaml if requested (default: true)
        if (options.config) {
          await generateConfigYaml(resolvedPath, options.force, logger);
        }

        // Create example entity if requested (default: true)
        if (options.example) {
          await generateExampleEntity(resolvedPath, options.force, logger, format);
        }

        logger.info("");
        logger.info(`Initialized gql-ingest configuration at: ${resolvedPath}`);
        logger.info("");
        logger.info("Next steps:");
        logger.info("  1. Edit entity files in each entity directory");
        logger.info(`  2. Run: gql-ingest -e <endpoint> ${resolvedPath}/example/entity.json`);
      } catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
          // User cancelled the prompt
          process.exit(0);
        }
        logger.error("Error initializing configuration:", error);
        process.exit(1);
      }
    });
}
