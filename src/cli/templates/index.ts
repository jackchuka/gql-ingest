import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { Logger } from "../../lib/logger";
import { CONFIG_TEMPLATE } from "../../lib/config-schema";

export type DataFormat = "csv" | "json" | "yaml" | "jsonl";

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
  for (const [key, fieldSchema] of Object.entries(schema.parallelProcessing.shape)) {
    const desc = getDesc(fieldSchema);
    if (desc) lines.push(`  # ${desc}`);
    lines.push(
      `  ${key}: ${defaults.parallelProcessing[key as keyof typeof defaults.parallelProcessing]}`,
    );
  }
  lines.push("");

  // retry section
  lines.push("retry:");
  for (const [key, fieldSchema] of Object.entries(schema.retry.shape)) {
    const desc = getDesc(fieldSchema);
    if (desc) lines.push(`  # ${desc}`);
    const value = defaults.retry[key as keyof typeof defaults.retry];
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

  // Generate data file
  const dataPath = path.join(basePath, "data", `${entityName}.${format}`);
  if (!fs.existsSync(dataPath) || force) {
    const dataContent = generateDataFile(format, fields);
    fs.writeFileSync(dataPath, dataContent, "utf-8");
    logger.info(`Created data/${entityName}.${format}`);
  } else {
    logger.warn(`data/${entityName}.${format} already exists, skipping`);
  }

  // Generate GraphQL file
  const graphqlPath = path.join(basePath, "graphql", `${entityName}.graphql`);
  if (!fs.existsSync(graphqlPath) || force) {
    const graphqlContent = generateGraphQLFile(mutationName, fields);
    fs.writeFileSync(graphqlPath, graphqlContent, "utf-8");
    logger.info(`Created graphql/${entityName}.graphql`);
  } else {
    logger.warn(`graphql/${entityName}.graphql already exists, skipping`);
  }

  // Generate mapping file
  const mappingPath = path.join(basePath, "mappings", `${entityName}.json`);
  if (!fs.existsSync(mappingPath) || force) {
    const mappingContent = generateMappingFile(entityName, format, fields);
    fs.writeFileSync(mappingPath, mappingContent, "utf-8");
    logger.info(`Created mappings/${entityName}.json`);
  } else {
    logger.warn(`mappings/${entityName}.json already exists, skipping`);
  }
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

function generateMappingFile(entityName: string, format: DataFormat, fields: string[]): string {
  const mapping = Object.fromEntries(fields.map((f) => [f, f]));

  const config = {
    dataFile: `data/${entityName}.${format}`,
    dataFormat: format,
    graphqlFile: `graphql/${entityName}.graphql`,
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

export function ensureDirectories(basePath: string, logger: Logger): void {
  const dirs = ["data", "graphql", "mappings"];
  for (const dir of dirs) {
    const dirPath = path.join(basePath, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Created directory: ${dir}/`);
    }
  }
}
