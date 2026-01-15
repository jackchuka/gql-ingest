import fs from "fs";
import path from "path";
import { Logger } from "../../lib/logger";
import { DEFAULT_RETRY_CONFIG, DEFAULT_PARALLEL_CONFIG } from "../../lib/config";

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
): Promise<void> {
  await generateEntityFiles(
    basePath,
    "example",
    {
      format: "csv",
      fields: ["id", "name", "email"],
      mutationName: "CreateUser",
    },
    logger,
    force,
  );
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

  const content = `# gql-ingest configuration
# See documentation for full options

parallelProcessing:
  concurrency: ${DEFAULT_PARALLEL_CONFIG.concurrency}
  entityConcurrency: ${DEFAULT_PARALLEL_CONFIG.entityConcurrency}
  preserveRowOrder: ${DEFAULT_PARALLEL_CONFIG.preserveRowOrder}

retry:
  maxAttempts: ${DEFAULT_RETRY_CONFIG.maxAttempts}
  baseDelay: ${DEFAULT_RETRY_CONFIG.baseDelay}
  maxDelay: ${DEFAULT_RETRY_CONFIG.maxDelay}
  exponentialBackoff: ${DEFAULT_RETRY_CONFIG.exponentialBackoff}

entityConfig: {}
entityDependencies: {}
`;

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
