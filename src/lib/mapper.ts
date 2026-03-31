import fs from "fs";
import path from "path";
import { parse, DocumentNode, VariableDefinitionNode, Kind } from "graphql";
import { DataReaderFactory, DataRow } from "../readers";
import { GraphQLClientWrapper } from "./graphql-client";
import { MetricsCollector } from "./metrics";
import { ParallelProcessingConfig, RetryConfig } from "./config";
import { Logger, noopLogger } from "./logger";
import {
  EntityStartEventPayload,
  EntityCompleteEventPayload,
  RowSuccessEventPayload,
  RowFailureEventPayload,
} from "./events";

export interface OutputCaptureConfig {
  /** JSONPath into the input row for the lookup key (e.g., "$.legalName") */
  key: string;
  /** Map of field names to JSONPaths into the mutation response */
  fields: Record<string, string>;
}

export type OutputStore = Map<string, Map<string, Record<string, unknown>>>;

class RefResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefResolutionError";
  }
}

export interface MappingConfig {
  name: string;
  dataFile: string;
  dataFormat?: string;
  graphqlFile: string;
  mapping: Record<string, unknown>;
  outputCapture?: OutputCaptureConfig;
}

/**
 * Callbacks for entity processing events
 */
export interface EntityProcessingCallbacks {
  onEntityStart?: (payload: Omit<EntityStartEventPayload, "waveIndex">) => void;
  onEntityComplete?: (payload: EntityCompleteEventPayload) => void;
  onRowSuccess?: (payload: RowSuccessEventPayload) => void;
  onRowFailure?: (payload: RowFailureEventPayload) => void;
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

  /**
   * Process an entity (backward-compatible method)
   */
  async processEntity(
    configPath: string,
    parallelConfig?: ParallelProcessingConfig,
    retryConfig?: RetryConfig,
  ): Promise<void> {
    return this.processEntityWithEvents(configPath, parallelConfig, retryConfig);
  }

  /**
   * Process an entity with event callbacks and abort support
   */
  async processEntityWithEvents(
    configPath: string,
    parallelConfig?: ParallelProcessingConfig,
    retryConfig?: RetryConfig,
    signal?: AbortSignal,
    callbacks?: EntityProcessingCallbacks,
    outputStore?: OutputStore,
  ): Promise<void> {
    const entityStartTime = Date.now();

    // Read entity configuration
    const configFullPath = path.resolve(this.basePath, configPath);
    const config: MappingConfig = JSON.parse(fs.readFileSync(configFullPath, "utf8"));
    const entityName = config.name;

    this.logger.info(`Processing entity: ${entityName}`);
    this.metrics.startEntityProcessing(entityName);

    // Resolve paths relative to entity file directory
    const entityDir = path.dirname(configFullPath);

    const dataPath = path.resolve(entityDir, config.dataFile);

    // Get appropriate reader (prioritize CLI format override, then config format)
    const format = this.formatOverride || config.dataFormat;
    const reader = DataReaderFactory.getReader(dataPath, format);
    const data = await reader.readFile(dataPath);

    const graphqlPath = path.resolve(entityDir, config.graphqlFile);
    const mutation = fs.readFileSync(graphqlPath, "utf8");

    // Emit entityStart event
    callbacks?.onEntityStart?.({
      entityName,
      mappingPath: configPath,
      totalRows: data.length,
    });

    if (parallelConfig && parallelConfig.concurrency > 1) {
      await this.processRowsConcurrentlyWithEvents(
        data,
        mutation,
        config.mapping,
        entityName,
        parallelConfig,
        retryConfig,
        signal,
        callbacks,
        config.outputCapture,
        outputStore,
      );
    } else {
      await this.processRowsSequentiallyWithEvents(
        data,
        mutation,
        config.mapping,
        entityName,
        retryConfig,
        signal,
        callbacks,
        config.outputCapture,
        outputStore,
      );
    }

    this.metrics.finishEntityProcessing(entityName);

    // Emit entityComplete event - convert internal metrics to EntityMetrics format
    const internalMetrics = this.metrics.getEntityMetrics(entityName);
    const duration = Date.now() - entityStartTime;
    const entityMetrics = internalMetrics
      ? {
          rowsProcessed: internalMetrics.successCount + internalMetrics.failureCount,
          successfulRows: internalMetrics.successCount,
          failedRows: internalMetrics.failureCount,
          duration,
        }
      : {
          rowsProcessed: 0,
          successfulRows: 0,
          failedRows: 0,
          duration,
        };

    callbacks?.onEntityComplete?.({
      entityName,
      metrics: entityMetrics,
      success: entityMetrics.failedRows === 0,
      durationMs: duration,
    });
  }

  private async processRowsSequentiallyWithEvents(
    data: DataRow[],
    mutation: string,
    mapping: Record<string, unknown>,
    entityName: string,
    retryConfig?: RetryConfig,
    signal?: AbortSignal,
    callbacks?: EntityProcessingCallbacks,
    outputCapture?: OutputCaptureConfig,
    outputStore?: OutputStore,
  ): Promise<void> {
    const totalRows = data.length;
    const variableTypes = this.extractVariableTypes(mutation);

    for (let i = 0; i < data.length; i++) {
      // Check for abort signal
      if (signal?.aborted) {
        this.logger.info(`Processing cancelled at row ${i + 1}/${totalRows}`);
        return;
      }

      const row = data[i];
      const rowStartTime = Date.now();

      try {
        const variables = this.mapRowToVariables(row, mapping, variableTypes, outputStore);
        const result = await this.client.executeMutation(mutation, variables, retryConfig, signal);
        this.metrics.recordSuccess(entityName);

        this.captureOutput(row, result, entityName, outputCapture, outputStore);

        // Emit row success event
        callbacks?.onRowSuccess?.({
          entityName,
          rowIndex: i,
          row,
          result,
          durationMs: Date.now() - rowStartTime,
        });

        // Show progress every 10% or at the end
        if ((i + 1) % Math.max(1, Math.floor(totalRows / 10)) === 0 || i === totalRows - 1) {
          const progress = (((i + 1) / totalRows) * 100).toFixed(1);
          this.logger.info(`📊 Progress: ${i + 1}/${totalRows} (${progress}%) ✓`);
        }
      } catch (error) {
        // Check if error is due to abort
        if (signal?.aborted) {
          this.logger.info(`Processing cancelled at row ${i + 1}/${totalRows}`);
          return;
        }

        this.metrics.recordFailure(entityName);
        this.logger.error(`✗ Failed to create entity for row ${i + 1}`, row, error);

        // Emit row failure event
        callbacks?.onRowFailure?.({
          entityName,
          rowIndex: i,
          row,
          error: error instanceof Error ? error : new Error(String(error)),
          retryAttempts: retryConfig?.maxAttempts ?? 3,
        });
      }
    }
  }

  private async processRowsConcurrentlyWithEvents(
    data: DataRow[],
    mutation: string,
    mapping: Record<string, unknown>,
    entityName: string,
    parallelConfig: ParallelProcessingConfig,
    retryConfig?: RetryConfig,
    signal?: AbortSignal,
    callbacks?: EntityProcessingCallbacks,
    outputCapture?: OutputCaptureConfig,
    outputStore?: OutputStore,
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
      // Check for abort signal before each chunk
      if (signal?.aborted) {
        this.logger.info(`Processing cancelled at chunk ${chunkIndex + 1}/${chunks.length}`);
        return;
      }

      const chunk = chunks[chunkIndex];
      const chunkStartIndex = chunkIndex * concurrency;

      const promises = chunk.map(async (row, index) => {
        const rowIndex = chunkStartIndex + index;
        const rowStartTime = Date.now();

        try {
          const variables = this.mapRowToVariables(row, mapping, variableTypes, outputStore);
          const result = await this.client.executeMutation(
            mutation,
            variables,
            retryConfig,
            signal,
          );
          this.metrics.recordSuccess(entityName);

          this.captureOutput(row, result, entityName, outputCapture, outputStore);

          // Emit row success event
          callbacks?.onRowSuccess?.({
            entityName,
            rowIndex,
            row,
            result,
            durationMs: Date.now() - rowStartTime,
          });

          return { success: true, result, row, rowIndex };
        } catch (error) {
          this.metrics.recordFailure(entityName);

          // Emit row failure event
          callbacks?.onRowFailure?.({
            entityName,
            rowIndex,
            row,
            error: error instanceof Error ? error : new Error(String(error)),
            retryAttempts: retryConfig?.maxAttempts ?? 3,
          });

          return { success: false, error, row, rowIndex };
        }
      });

      const results = await Promise.allSettled(promises);
      processedCount += chunk.length;

      // Check if cancelled during chunk processing
      if (signal?.aborted) {
        this.logger.info(`Processing cancelled after chunk ${chunkIndex + 1}/${chunks.length}`);
        return;
      }

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
    outputStore?: OutputStore,
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
        const dataPath = this.stripJsonPathPrefix(mappingValue);
        const value = this.getValueByPath(row, dataPath);
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
      } else if (this.isRefMapping(mappingValue)) {
        variables[graphqlVar] = this.resolveRef(row, mappingValue, outputStore);
      }
      // Handle complex mapping object
      else if (typeof mappingValue === "object" && mappingValue !== null) {
        variables[graphqlVar] = this.mapNestedObject(row, mappingValue, variableTypes, outputStore);
      }
    }

    if (outputStore) {
      for (const [key, value] of Object.entries(variables)) {
        variables[key] = this.resolveRefsInData(value, row, outputStore);
      }
    }

    return variables;
  }

  private getValueByPath(obj: any, dataPath: string): any {
    const parts = dataPath.split(".");
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
    outputStore?: OutputStore,
  ): any {
    if (Array.isArray(mappingObj)) {
      return mappingObj.map((item) => this.mapNestedObject(row, item, variableTypes, outputStore));
    }

    if (typeof mappingObj === "object" && mappingObj !== null) {
      if (this.isRefMapping(mappingObj)) {
        return this.resolveRef(row, mappingObj, outputStore);
      }

      const result: any = {};
      for (const [key, value] of Object.entries(mappingObj)) {
        if (typeof value === "string" && value.startsWith("$.")) {
          const dataPath = this.stripJsonPathPrefix(value);
          let fieldValue = this.getValueByPath(row, dataPath);

          // Handle special case for array fields (e.g., comma-separated values)
          if (key === "values" && typeof fieldValue === "string" && fieldValue.includes(",")) {
            fieldValue = fieldValue.split(",").map((v) => v.trim());
          }

          result[key] = fieldValue;
        } else if (typeof value === "string" && row[value] !== undefined) {
          result[key] = row[value];
        } else if (this.isRefMapping(value)) {
          result[key] = this.resolveRef(row, value, outputStore);
        } else if (typeof value === "object") {
          result[key] = this.mapNestedObject(row, value, variableTypes, outputStore);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return mappingObj;
  }

  /**
   * Recursively walk a resolved value and resolve any $ref objects found in data.
   * Unlike mapping-level $ref (where key is a JSONPath into the row), data-level
   * $ref uses key as a literal lookup value unless it starts with "$.".
   */
  private resolveRefsInData(value: unknown, row: DataRow, outputStore: OutputStore): unknown {
    if (Array.isArray(value)) {
      let changed = false;
      const mapped = value.map((item) => {
        const resolved = this.resolveRefsInData(item, row, outputStore);
        if (resolved !== item) changed = true;
        return resolved;
      });
      return changed ? mapped : value;
    }

    if (typeof value === "object" && value !== null) {
      if (this.isRefMapping(value)) {
        const keyStr = value.key.startsWith("$.")
          ? String(this.getValueByPath(row, this.stripJsonPathPrefix(value.key)) ?? value.key)
          : value.key;
        return this.lookupRef(outputStore, value.$ref, keyStr, value.field);
      }

      let changed = false;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        const resolved = this.resolveRefsInData(v, row, outputStore);
        if (resolved !== v) changed = true;
        result[k] = resolved;
      }
      return changed ? result : value;
    }

    return value;
  }

  private stripJsonPathPrefix(jsonPath: string): string {
    return jsonPath.startsWith("$.") ? jsonPath.substring(2) : jsonPath;
  }

  private isRefMapping(value: unknown): value is { $ref: string; key: string; field: string } {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "$ref" in value &&
      "key" in value &&
      "field" in value
    );
  }

  /** Resolve a mapping-level $ref — throws on any failure so the row is skipped. */
  private resolveRef(
    row: DataRow,
    ref: { $ref: string; key: string; field: string },
    outputStore?: OutputStore,
  ): unknown {
    if (!outputStore) {
      throw new RefResolutionError(`$ref to "${ref.$ref}" found but no output store is available`);
    }

    const keyPath = this.stripJsonPathPrefix(ref.key);
    const lookupKeyValue = this.getValueByPath(row, keyPath);

    if (lookupKeyValue === undefined) {
      throw new RefResolutionError(`$ref lookup key "${ref.key}" not found in current row`);
    }

    const keyStr = String(lookupKeyValue);
    const value = this.lookupRef(outputStore, ref.$ref, keyStr, ref.field);

    if (value === undefined) {
      throw new RefResolutionError(
        `$ref resolution failed for "${ref.$ref}[${keyStr}].${ref.field}"`,
      );
    }

    return value;
  }

  /**
   * Core ref lookup: entityName -> key -> field.
   * Returns undefined with a warning on miss (caller decides whether to throw).
   */
  private lookupRef(
    outputStore: OutputStore,
    entityName: string,
    keyStr: string,
    field: string,
  ): unknown {
    const entityStore = outputStore.get(entityName);
    if (!entityStore) {
      this.logger.warn(`$ref entity "${entityName}" not found in output store`);
      return undefined;
    }

    const captured = entityStore.get(keyStr);
    if (!captured) {
      this.logger.warn(`$ref key "${keyStr}" not found in entity "${entityName}" output store`);
      return undefined;
    }

    const value = captured[field];
    if (value === undefined) {
      this.logger.warn(
        `$ref field "${field}" not found in captured output for "${entityName}[${keyStr}]"`,
      );
    }

    return value;
  }

  private captureOutput(
    row: DataRow,
    result: any,
    entityName: string,
    outputCapture?: OutputCaptureConfig,
    outputStore?: OutputStore,
  ): void {
    if (!outputCapture || !outputStore) return;

    const keyPath = this.stripJsonPathPrefix(outputCapture.key);
    const keyValue = this.getValueByPath(row, keyPath);

    if (keyValue === undefined) {
      this.logger.warn(
        `outputCapture key "${outputCapture.key}" not found in input row for entity "${entityName}". Skipping capture.`,
      );
      return;
    }

    const keyStr = String(keyValue);

    const captured: Record<string, unknown> = {};
    for (const [fieldName, responsePath] of Object.entries(outputCapture.fields)) {
      const dataPath = this.stripJsonPathPrefix(responsePath);
      captured[fieldName] = this.getValueByPath(result, dataPath);
    }

    let entityStore = outputStore.get(entityName);
    if (!entityStore) {
      entityStore = new Map();
      outputStore.set(entityName, entityStore);
    }

    if (entityStore.has(keyStr)) {
      this.logger.warn(
        `outputCapture: duplicate key "${keyStr}" for entity "${entityName}" — overwriting previous value`,
      );
    }
    entityStore.set(keyStr, captured);
  }

  private extractVariableTypes(mutation: string): Record<string, string> {
    const types: Record<string, string> = {};

    try {
      const document: DocumentNode = parse(mutation);

      // Find the operation (mutation/query) and extract variable definitions
      for (const definition of document.definitions) {
        if (definition.kind === Kind.OPERATION_DEFINITION && definition.variableDefinitions) {
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

    if (type.kind === Kind.NON_NULL_TYPE) {
      // Handle non-null types like String!
      if (type.type.kind === Kind.NAMED_TYPE) {
        return type.type.name.value;
      }
    } else if (type.kind === Kind.NAMED_TYPE) {
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
