import fs from "fs";
import path from "path";
import { parse, DocumentNode, VariableDefinitionNode } from "graphql";
import { DataReaderFactory, DataRow } from "../readers";
import { GraphQLClientWrapper } from "./graphql-client";
import { MetricsCollector } from "./metrics";
import { ParallelProcessingConfig, RetryConfig } from "./config";
import { Logger, noopLogger } from "./logger";

export interface MappingConfig {
  // Legacy CSV support
  csvFile?: string;
  // New flexible data file support
  dataFile?: string;
  dataFormat?: string;
  graphqlFile: string;
  mapping: Record<string, unknown>;
}

export class DataMapper {
  private client: GraphQLClientWrapper;
  private basePath: string;
  private metrics: MetricsCollector;
  private logger: Logger;
  private formatOverride?: string;

  constructor(
    client: GraphQLClientWrapper,
    basePath: string = process.cwd(),
    metrics?: MetricsCollector,
    logger: Logger = noopLogger,
    formatOverride?: string,
  ) {
    this.client = client;
    this.basePath = basePath;
    this.metrics = metrics || new MetricsCollector();
    this.logger = logger;
    this.formatOverride = formatOverride;
  }

  discoverMappings(configDir: string, entityFilter?: string[]): string[] {
    const mappingsPath = path.resolve(this.basePath, configDir, "mappings");

    try {
      const files = fs.readdirSync(mappingsPath);
      let jsonFiles = files.filter((file) => file.endsWith(".json"));

      // Apply entity filter if provided
      if (entityFilter && entityFilter.length > 0) {
        const requestedEntities = new Set(entityFilter);
        const foundEntities = new Set<string>();

        jsonFiles = jsonFiles.filter((file) => {
          const entityName = path.basename(file, ".json");
          if (requestedEntities.has(entityName)) {
            foundEntities.add(entityName);
            return true;
          }
          return false;
        });

        // Check for requested entities that were not found
        const notFound = entityFilter.filter((e) => !foundEntities.has(e));
        if (notFound.length > 0) {
          this.logger.warn(
            `Warning: The following entities were not found in mappings: ${notFound.join(", ")}`,
          );
        }
      }

      jsonFiles.sort(); // Alphabetical order for consistent processing

      this.logger.info(`Discovered ${jsonFiles.length} mapping files: ${jsonFiles.join(", ")}`);
      return jsonFiles.map((file) => path.join(configDir, "mappings", file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error reading mappings directory ${mappingsPath}: ${message}`);
      return [];
    }
  }

  async processEntity(
    configPath: string,
    parallelConfig?: ParallelProcessingConfig,
    retryConfig?: RetryConfig,
  ): Promise<void> {
    const entityName = path.basename(configPath, ".json");
    this.logger.info(`Processing entity: ${configPath}`);

    this.metrics.startEntityProcessing(entityName);

    // Read mapping configuration
    const configFullPath = path.resolve(this.basePath, configPath);
    const config: MappingConfig = JSON.parse(fs.readFileSync(configFullPath, "utf8"));

    // Extract config directory (parent of mappings directory)
    const configDir = path.dirname(path.dirname(configFullPath));

    // Determine data file path (support both legacy csvFile and new dataFile)
    const dataFile = config.dataFile || config.csvFile;
    if (!dataFile) {
      throw new Error(`No data file specified in mapping config: ${configPath}`);
    }

    const dataPath = path.resolve(configDir, dataFile);

    // Get appropriate reader (prioritize CLI format override, then config format)
    const format = this.formatOverride || config.dataFormat;
    const reader = DataReaderFactory.getReader(dataPath, format);
    const data = await reader.readFile(dataPath);

    // Read GraphQL mutation (relative to config directory)
    const graphqlPath = path.resolve(configDir, config.graphqlFile);
    const mutation = fs.readFileSync(graphqlPath, "utf8");

    // Process rows with optional parallelization
    if (parallelConfig && parallelConfig.concurrency > 1) {
      await this.processRowsConcurrently(
        data,
        mutation,
        config.mapping,
        entityName,
        parallelConfig,
        retryConfig,
      );
    } else {
      await this.processRowsSequentially(data, mutation, config.mapping, entityName, retryConfig);
    }

    this.metrics.finishEntityProcessing(entityName);
  }

  private async processRowsSequentially(
    data: DataRow[],
    mutation: string,
    mapping: Record<string, unknown>,
    entityName: string,
    retryConfig?: RetryConfig,
  ): Promise<void> {
    const totalRows = data.length;
    const variableTypes = this.extractVariableTypes(mutation);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const variables = this.mapRowToVariables(row, mapping, variableTypes);

      try {
        await this.client.executeMutation(mutation, variables, retryConfig);
        this.metrics.recordSuccess(entityName);

        // Show progress every 10% or at the end
        if ((i + 1) % Math.max(1, Math.floor(totalRows / 10)) === 0 || i === totalRows - 1) {
          const progress = (((i + 1) / totalRows) * 100).toFixed(1);
          this.logger.info(`📊 Progress: ${i + 1}/${totalRows} (${progress}%) ✓`);
        }
      } catch (error) {
        this.metrics.recordFailure(entityName);
        this.logger.error(`✗ Failed to create entity for row ${i + 1}`, row, error);
      }
    }
  }

  private async processRowsConcurrently(
    data: DataRow[],
    mutation: string,
    mapping: Record<string, unknown>,
    entityName: string,
    parallelConfig: ParallelProcessingConfig,
    retryConfig?: RetryConfig,
  ): Promise<void> {
    const concurrency = parallelConfig.concurrency;
    this.logger.info(`Processing ${data.length} rows with concurrency: ${concurrency}`);

    // Extract variable types once for all rows
    const variableTypes = this.extractVariableTypes(mutation);

    // Split data into chunks for concurrent processing
    const chunks = this.chunkArray(data, concurrency);
    let processedCount = 0;
    const totalRows = data.length;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const promises = chunk.map(async (row) => {
        const variables = this.mapRowToVariables(row, mapping, variableTypes);

        try {
          const result = await this.client.executeMutation(mutation, variables, retryConfig);
          this.metrics.recordSuccess(entityName);
          return { success: true, result, row };
        } catch (error) {
          this.metrics.recordFailure(entityName);
          return { success: false, error, row };
        }
      });

      const results = await Promise.allSettled(promises);
      processedCount += chunk.length;

      // Count successes and failures in this chunk
      let chunkSuccesses = 0;
      let chunkFailures = 0;

      results.forEach((result) => {
        if (result.status === "fulfilled") {
          const { success, error, row } = result.value;
          if (success) {
            chunkSuccesses++;
          } else {
            chunkFailures++;
            this.logger.error(`✗ Failed to create entity for row`, row, error);
          }
        } else {
          chunkFailures++;
          this.logger.error(`✗ Promise rejected: ${result.reason}`);
        }
      });

      // Show progress update
      const progress = ((processedCount / totalRows) * 100).toFixed(1);
      this.logger.info(
        `📊 Progress: ${processedCount}/${totalRows} (${progress}%) - Chunk ${
          chunkIndex + 1
        }: ${chunkSuccesses} ✓, ${chunkFailures} ✗`,
      );
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private mapRowToVariables(
    row: DataRow,
    mapping: Record<string, unknown>,
    variableTypes: Record<string, string>,
  ): Record<string, any> {
    const variables: Record<string, any> = {};

    for (const [graphqlVar, mappingValue] of Object.entries(mapping)) {
      // Handle direct mapping for nested data (e.g., "input": "$")
      if (mappingValue === "$") {
        // Use the entire row as the variable value
        variables[graphqlVar] = row;
      }
      // Handle path-based mapping for nested data (e.g., "input.name": "$.product.name")
      else if (typeof mappingValue === "string" && mappingValue.startsWith("$.")) {
        const path = mappingValue.substring(2); // Remove '$.'
        const value = this.getValueByPath(row, path);
        if (value !== undefined) {
          const type = variableTypes[graphqlVar];
          variables[graphqlVar] = this.convertValue(value, type, graphqlVar);
        }
      }
      // Handle traditional flat mapping (e.g., "name": "product_name")
      else if (typeof mappingValue === "string" && row[mappingValue] !== undefined) {
        const rawValue = row[mappingValue];
        const type = variableTypes[graphqlVar];
        variables[graphqlVar] = this.convertValue(rawValue, type, graphqlVar);
      }
      // Handle complex mapping object
      else if (typeof mappingValue === "object" && mappingValue !== null) {
        variables[graphqlVar] = this.mapNestedObject(row, mappingValue, variableTypes);
      }
    }

    return variables;
  }

  private getValueByPath(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;

    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private mapNestedObject(
    row: DataRow,
    mappingObj: any,
    variableTypes: Record<string, string>,
  ): any {
    if (Array.isArray(mappingObj)) {
      return mappingObj.map((item) => this.mapNestedObject(row, item, variableTypes));
    }

    if (typeof mappingObj === "object" && mappingObj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(mappingObj)) {
        if (typeof value === "string" && value.startsWith("$.")) {
          const path = value.substring(2);
          let fieldValue = this.getValueByPath(row, path);

          // Handle special case for array fields (e.g., comma-separated values)
          if (key === "values" && typeof fieldValue === "string" && fieldValue.includes(",")) {
            fieldValue = fieldValue.split(",").map((v) => v.trim());
          }

          result[key] = fieldValue;
        } else if (typeof value === "string" && row[value] !== undefined) {
          result[key] = row[value];
        } else if (typeof value === "object") {
          result[key] = this.mapNestedObject(row, value, variableTypes);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return mappingObj;
  }

  private extractVariableTypes(mutation: string): Record<string, string> {
    const types: Record<string, string> = {};

    try {
      const document: DocumentNode = parse(mutation);

      // Find the operation (mutation/query) and extract variable definitions
      for (const definition of document.definitions) {
        if (definition.kind === "OperationDefinition" && definition.variableDefinitions) {
          for (const variableDef of definition.variableDefinitions) {
            const varName = variableDef.variable.name.value;
            const typeName = this.extractTypeName(variableDef);
            if (typeName) {
              types[varName] = typeName;
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error parsing GraphQL mutation: ${message}`);
    }

    return types;
  }

  private extractTypeName(variableDef: VariableDefinitionNode): string | null {
    const type = variableDef.type;

    if (type.kind === "NonNullType") {
      // Handle non-null types like String!
      if (type.type.kind === "NamedType") {
        return type.type.name.value;
      }
    } else if (type.kind === "NamedType") {
      // Handle nullable types like String
      return type.name.value;
    }

    return null;
  }

  private convertValue(value: any, type: string | undefined, varName: string): any {
    if (!type) {
      // No type information available, keep as is
      return value;
    }

    // For non-string values (objects, arrays), return as is
    if (typeof value !== "string") {
      return value;
    }

    const trimmedValue = value.trim();

    switch (type) {
      case "Int":
        const intValue = Number(trimmedValue);
        // Validate that it's a valid integer (no decimals, NaN, or Infinity)
        if (isNaN(intValue) || !isFinite(intValue) || !Number.isInteger(intValue)) {
          this.logger.warn(
            `Warning: Cannot convert "${value}" to Int for variable $${varName}. Expected a valid integer. Using original value.`,
          );
          return value;
        }
        return intValue;

      case "Float":
        const floatValue = Number(trimmedValue);
        // Number() is more strict than parseFloat() - it requires the entire string to be valid
        if (isNaN(floatValue) || !isFinite(floatValue)) {
          this.logger.warn(
            `Warning: Cannot convert "${value}" to Float for variable $${varName}. Expected a valid number. Using original value.`,
          );
          return value;
        }
        return floatValue;

      case "Boolean":
        const lowerValue = trimmedValue.toLowerCase();
        if (lowerValue === "true" || lowerValue === "1") return true;
        if (lowerValue === "false" || lowerValue === "0") return false;
        this.logger.warn(
          `Warning: Cannot convert "${value}" to Boolean for variable $${varName}. Expected "true", "false", "1", or "0". Using original value.`,
        );
        return value;

      case "String":
        return value;

      default:
        // Unknown scalar type - keep as string for safety
        this.logger.debug(
          `Unknown GraphQL type "${type}" for variable $${varName}. Keeping value as string.`,
        );
        return value;
    }
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }
}
