import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { Logger, noopLogger } from "./logger";
import {
  DEFAULT_RETRY_CONFIG,
  DEFAULT_PARALLEL_CONFIG,
  type Config,
  type ParallelProcessingConfig,
  type RetryConfig,
} from "./config-schema";

export type { Config, ParallelProcessingConfig, RetryConfig, EntityConfig } from "./config-schema";

export { DEFAULT_RETRY_CONFIG, DEFAULT_PARALLEL_CONFIG } from "./config-schema";

export const DEFAULT_CONFIG: Config = {
  retry: DEFAULT_RETRY_CONFIG,
  parallelProcessing: DEFAULT_PARALLEL_CONFIG,
  entityConfig: {},
  entityDependencies: {},
};

export function loadConfig(configDir: string, logger: Logger = noopLogger): Config {
  const configPath = path.join(configDir, "config.yaml");

  try {
    if (!fs.existsSync(configPath)) {
      logger.info("No config.yaml found, using default sequential processing");
      return DEFAULT_CONFIG;
    }

    const fileContents = fs.readFileSync(configPath, "utf8");
    const yamlConfig = yaml.load(fileContents) as Partial<Config>;

    return mergeWithDefaults(yamlConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Warning: Failed to parse config.yaml: ${errorMessage}. Using defaults.`);
    return DEFAULT_CONFIG;
  }
}

function mergeWithDefaults(yamlConfig: Partial<Config>): Config {
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
  globalConfig: Config,
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

export function getRetryConfig(entityName: string, globalConfig: Config): RetryConfig {
  const entityOverrides = globalConfig.entityConfig[entityName]?.retry || {};

  return {
    ...globalConfig.retry,
    ...entityOverrides,
  };
}
