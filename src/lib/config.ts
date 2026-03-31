import fs from "fs";
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

export function loadConfig(
  configFile?: string,
  logger: Logger = noopLogger,
): Config {
  if (!configFile) {
    logger.info("No config file provided, using defaults");
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(configFile, "utf-8");
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const yamlConfig = yaml.load(content) as Partial<Config>;
    logger.info(`Loaded config from ${configFile}`);
    return mergeWithDefaults(yamlConfig);
  } catch (error) {
    const isNotFound =
      error instanceof Error &&
      "code" in error &&
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      (error as NodeJS.ErrnoException).code === "ENOENT";
    if (isNotFound) {
      logger.info(`Config file not found at ${configFile}, using defaults`);
    } else {
      logger.warn(`Failed to parse ${configFile}, using defaults`);
    }
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
