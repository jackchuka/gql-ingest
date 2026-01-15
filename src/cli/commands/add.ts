import { Command } from "commander";
import path from "path";
import { input, select } from "@inquirer/prompts";
import { createConsoleLogger, noopLogger } from "../../lib/logger";
import { generateEntityFiles, validateEntityName, toPascalCase, DataFormat } from "../templates";

interface AddOptions {
  path: string;
  format?: string;
  fields?: string;
  mutation?: string;
  interactive: boolean;
  quiet: boolean;
}

export function registerAddCommand(program: Command): void {
  program
    .command("add <entity-name>")
    .description("Add a new entity to the configuration")
    .option("-p, --path <path>", "Config directory path", process.cwd())
    .option("-f, --format <format>", "Data format (csv, json, yaml, jsonl)")
    .option("--fields <fields>", "Comma-separated field names")
    .option("--mutation <name>", "GraphQL mutation name")
    .option("--no-interactive", "Skip prompts, use defaults only")
    .option("-q, --quiet", "Suppress output", false)
    .action(async (entityName: string, options: AddOptions) => {
      const logger = options.quiet ? noopLogger : createConsoleLogger();
      const configPath = path.resolve(options.path);

      try {
        // Validate entity name
        if (!validateEntityName(entityName)) {
          logger.error(
            "Invalid entity name. Use alphanumeric characters, hyphens, and underscores. Must start with a letter.",
          );
          process.exit(1);
        }

        // Determine if interactive mode is available
        const isInteractive = options.interactive && process.stdin.isTTY;

        let format: DataFormat;
        let fields: string[];
        let mutationName: string;

        if (isInteractive) {
          // Interactive prompts
          format = (await select({
            message: "Select data format:",
            choices: [
              { name: "CSV", value: "csv" },
              { name: "JSON", value: "json" },
              { name: "YAML", value: "yaml" },
              { name: "JSONL", value: "jsonl" },
            ],
            default: "csv",
          })) as DataFormat;

          const fieldsInput = await input({
            message: "Enter field names (comma-separated):",
            default: "id,name",
          });
          fields = fieldsInput
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean);

          mutationName = await input({
            message: "GraphQL mutation name:",
            default: `Create${toPascalCase(entityName)}`,
          });
        } else {
          // Non-interactive: use options or defaults
          const validFormats = ["csv", "json", "yaml", "jsonl"];
          if (options.format && !validFormats.includes(options.format)) {
            logger.error(`Invalid format. Must be one of: ${validFormats.join(", ")}`);
            process.exit(1);
          }

          format = (options.format as DataFormat) || "csv";
          fields = options.fields
            ?.split(",")
            .map((f) => f.trim())
            .filter(Boolean) || ["id", "name"];
          mutationName = options.mutation || `Create${toPascalCase(entityName)}`;
        }

        // Generate files
        await generateEntityFiles(
          configPath,
          entityName,
          {
            format,
            fields,
            mutationName,
          },
          logger,
        );

        logger.info("");
        logger.info(`Created entity: ${entityName}`);
        logger.info(`  - data/${entityName}.${format}`);
        logger.info(`  - graphql/${entityName}.graphql`);
        logger.info(`  - mappings/${entityName}.json`);
      } catch (error) {
        if ((error as Error).name === "ExitPromptError") {
          // User cancelled the prompt
          process.exit(0);
        }
        logger.error("Error adding entity:", error);
        process.exit(1);
      }
    });
}
