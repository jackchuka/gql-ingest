import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { Logger, noopLogger } from "./logger";

export interface ParallelProcessingConfig {
  concurrency: number;
  entityConcurrency: number;
  preserveRowOrder: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBackoff: boolean;
  retryableStatusCodes: number[];
}

export interface EntityConfig {
  concurrency?: number;
  preserveRowOrder?: boolean;
  retry?: Partial<RetryConfig>;
}

export interface ProcessingConfig {
  retry: RetryConfig;
  parallelProcessing: ParallelProcessingConfig;
  entityConfig: Record<string, EntityConfig>;
  entityDependencies: Record<string, string[]>;
}

export interface FullConfig extends ProcessingConfig {
  // Future: additional config sections can be added here
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialBackoff: true,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

export const DEFAULT_PARALLEL_CONFIG: ParallelProcessingConfig = {
  concurrency: 1,
  entityConcurrency: 1,
  preserveRowOrder: true,
};

export const DEFAULT_CONFIG: ProcessingConfig = {
  retry: DEFAULT_RETRY_CONFIG,
  parallelProcessing: DEFAULT_PARALLEL_CONFIG,
  entityConfig: {},
  entityDependencies: {},
};

export function loadConfig(configDir: string, logger: Logger = noopLogger): ProcessingConfig {
  const configPath = path.join(configDir, "config.yaml");

  try {
    if (!fs.existsSync(configPath)) {
      logger.info("No config.yaml found, using default sequential processing");
      return DEFAULT_CONFIG;
    }

    const fileContents = fs.readFileSync(configPath, "utf8");
    const yamlConfig = yaml.load(fileContents) as Partial<FullConfig>;

    return mergeWithDefaults(yamlConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Warning: Failed to parse config.yaml: ${errorMessage}. Using defaults.`);
    return DEFAULT_CONFIG;
  }
}

function mergeWithDefaults(yamlConfig: Partial<FullConfig>): ProcessingConfig {
  return {
    retry: {
      ...DEFAULT_RETRY_CONFIG,
      ...yamlConfig.retry,
    },
    parallelProcessing: {
      ...DEFAULT_PARALLEL_CONFIG,
      ...yamlConfig.parallelProcessing,
    },
    entityConfig: yamlConfig.entityConfig || {},
    entityDependencies: yamlConfig.entityDependencies || {},
  };
}

export function getEntityConfig(
  entityName: string,
  globalConfig: ProcessingConfig,
  logger: Logger = noopLogger,
): ParallelProcessingConfig {
  const entityOverrides = globalConfig.entityConfig[entityName] || {};

  let finalConfig = {
    ...globalConfig.parallelProcessing,
    ...entityOverrides,
  };

  // Apply constraint: preserveRowOrder forces concurrency = 1
  if (finalConfig.preserveRowOrder && finalConfig.concurrency > 1) {
    logger.warn(
      `Entity '${entityName}': preserveRowOrder=true forces concurrency=1 (was ${finalConfig.concurrency})`,
    );
    finalConfig.concurrency = 1;
  }

  return finalConfig;
}

export function getRetryConfig(entityName: string, globalConfig: ProcessingConfig): RetryConfig {
  const entityOverrides = globalConfig.entityConfig[entityName]?.retry || {};

  return {
    ...globalConfig.retry,
    ...entityOverrides,
  };
}
