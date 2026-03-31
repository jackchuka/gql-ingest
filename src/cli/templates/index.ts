import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { Logger } from "../../lib/logger";
import { CONFIG_TEMPLATE } from "../../lib/config-schema";

export type DataFormat = "csv" | "json" | "yaml" | "jsonl";

const DATA_FORMATS: Set<string> = new Set(["csv", "json", "yaml", "jsonl"]);

export function isDataFormat(value: string): value is DataFormat {
  return DATA_FORMATS.has(value);
}

export const DATA_FORMAT_CHOICES = [
  { name: "CSV", value: "csv" as const },
  { name: "JSON", value: "json" as const },
  { name: "YAML", value: "yaml" as const },
  { name: "JSONL", value: "jsonl" as const },
] as const;

export const DEFAULT_DATA_FORMAT: DataFormat = "csv";

export interface EntityTemplateOptions {
  format: DataFormat;
  fields: string[];
  mutationName: string;
}

export async function generateExampleEntity(
  basePath: string,
  force: boolean,
  logger: Logger,
  format: DataFormat = "csv",
): Promise<void> {
  await generateEntityFiles(
    basePath,
    "example",
    {
      format,
      fields: ["id", "name", "email"],
      mutationName: "CreateUser",
    },
    logger,
    force,
  );
}

function getDesc(schema: { description?: string }): string | undefined {
  return schema.description;
}

function isKeyOf<T extends object>(obj: T, key: string): key is keyof T & string {
  return key in obj;
}

function toCommentedYaml(obj: Record<string, unknown>): string[] {
  return yaml
    .dump(obj, { flowLevel: 2 })
    .trimEnd()
    .split("\n")
    .map((line) => `# ${line}`);
}

function generateConfigYamlContent(): string {
  const { schema, defaults, examples } = CONFIG_TEMPLATE;
  const lines: string[] = ["# gql-ingest configuration", ""];

  // parallelProcessing section
  lines.push("parallelProcessing:");
  for (const [key, value] of Object.entries(defaults.parallelProcessing)) {
    if (isKeyOf(schema.parallelProcessing.shape, key)) {
      const desc = getDesc(schema.parallelProcessing.shape[key]);
      if (desc) lines.push(`  # ${desc}`);
    }
    lines.push(`  ${key}: ${value}`);
  }
  lines.push("");

  // retry section
  lines.push("retry:");
  for (const [key, value] of Object.entries(defaults.retry)) {
    if (isKeyOf(schema.retry.shape, key)) {
      const desc = getDesc(schema.retry.shape[key]);
      if (desc) lines.push(`  # ${desc}`);
    }
    lines.push(`  ${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`);
  }
  lines.push("");

  // entityConfig section
  const entityConfigDesc = getDesc(schema.entityConfig);
  if (entityConfigDesc) lines.push(`# ${entityConfigDesc}`);
  lines.push("# Example:");
  lines.push(...toCommentedYaml({ entityConfig: examples.entityConfig }));
  lines.push("entityConfig: {}");
  lines.push("");

  // entityDependencies section
  const entityDepsDesc = getDesc(schema.entityDependencies);
  if (entityDepsDesc) lines.push(`# ${entityDepsDesc}`);
  lines.push("# Example:");
  lines.push(...toCommentedYaml({ entityDependencies: examples.entityDependencies }));
  lines.push("entityDependencies: {}");
  lines.push("");

  return lines.join("\n");
}

export async function generateConfigYaml(
  basePath: string,
  force: boolean,
  logger: Logger,
): Promise<void> {
  const configPath = path.join(basePath, "config.yaml");

  if (fs.existsSync(configPath) && !force) {
    logger.warn("config.yaml already exists, skipping (use --force to overwrite)");
    return;
  }

  const content = generateConfigYamlContent();
  fs.writeFileSync(configPath, content, "utf-8");
  logger.info("Created config.yaml");
}

export async function generateEntityFiles(
  basePath: string,
  entityName: string,
  options: EntityTemplateOptions,
  logger: Logger,
  force = false,
): Promise<void> {
  const { format, fields, mutationName } = options;
  const entityDir = path.join(basePath, entityName);

  if (!fs.existsSync(entityDir)) {
    fs.mkdirSync(entityDir, { recursive: true });
    logger.info(`Created directory: ${entityName}/`);
  }

  const writeFile = (filePath: string, content: string, label: string) => {
    if (!fs.existsSync(filePath) || force) {
      fs.writeFileSync(filePath, content, "utf-8");
      logger.info(`Created ${label}`);
    } else {
      logger.warn(`${label} already exists, skipping`);
    }
  };

  writeFile(
    path.join(entityDir, `${entityName}.${format}`),
    generateDataFile(format, fields),
    `${entityName}/${entityName}.${format}`,
  );

  writeFile(
    path.join(entityDir, `${entityName}.graphql`),
    generateGraphQLFile(mutationName, fields),
    `${entityName}/${entityName}.graphql`,
  );

  writeFile(
    path.join(entityDir, `${entityName}.json`),
    generateEntityDefFile(entityName, format, fields),
    `${entityName}/${entityName}.json`,
  );
}

function generateDataFile(format: DataFormat, fields: string[]): string {
  const sampleValues = fields.map((f, i) => `sample_${f}_${i + 1}`);

  switch (format) {
    case "csv":
      return `${fields.join(",")}\n${sampleValues.join(",")}`;

    case "json":
      const jsonObj = Object.fromEntries(fields.map((f, i) => [f, sampleValues[i]]));
      return JSON.stringify([jsonObj], null, 2);

    case "yaml":
      const [firstField, ...restFields] = fields;
      const firstLine = `- ${firstField}: ${sampleValues[0]}`;
      const restLines = restFields.map((f, i) => `  ${f}: ${sampleValues[i + 1]}`);
      return [firstLine, ...restLines].join("\n");

    case "jsonl":
      const jsonlObj = Object.fromEntries(fields.map((f, i) => [f, sampleValues[i]]));
      return JSON.stringify(jsonlObj);

    default:
      return "";
  }
}

function generateGraphQLFile(mutationName: string, fields: string[]): string {
  const params = fields.map((f) => `$${f}: String!`).join(", ");
  const inputFields = fields.map((f) => `${f}: $${f}`).join(", ");
  // Filter out 'id' from response fields since it's always included
  const otherFields = fields.filter((f) => f !== "id");
  const responseFields = otherFields.map((f) => `    ${f}`).join("\n");
  const operationName = toLowerCamelCase(mutationName);

  return `mutation ${mutationName}(${params}) {
  ${operationName}(input: { ${inputFields} }) {
    id
${responseFields}
  }
}
`;
}

function generateEntityDefFile(entityName: string, format: DataFormat, fields: string[]): string {
  const mapping = Object.fromEntries(fields.map((f) => [f, f]));

  const config = {
    dataFile: `${entityName}.${format}`,
    dataFormat: format,
    graphqlFile: `${entityName}.graphql`,
    mapping,
  };

  return JSON.stringify(config, null, 2) + "\n";
}

function toLowerCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export function validateEntityName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

export function ensureDirectories(basePath: string, _logger: Logger): void {
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
  }
}
