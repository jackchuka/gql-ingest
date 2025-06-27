import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

export interface ParallelProcessingConfig {
  concurrency: number;
  entityConcurrency: number;
  preserveRowOrder: boolean;
}

export interface EntityConfig {
  concurrency?: number;
  preserveRowOrder?: boolean;
}

export interface ProcessingConfig {
  parallelProcessing: ParallelProcessingConfig;
  entityConfig: Record<string, EntityConfig>;
  entityDependencies: Record<string, string[]>;
}

export interface FullConfig extends ProcessingConfig {
  // Future: additional config sections can be added here
}

export const DEFAULT_PARALLEL_CONFIG: ParallelProcessingConfig = {
  concurrency: 1,
  entityConcurrency: 1,
  preserveRowOrder: true,
};

export const DEFAULT_CONFIG: ProcessingConfig = {
  parallelProcessing: DEFAULT_PARALLEL_CONFIG,
  entityConfig: {},
  entityDependencies: {},
};

export function loadConfig(configDir: string): ProcessingConfig {
  const configPath = path.join(configDir, "config.yaml");

  try {
    if (!fs.existsSync(configPath)) {
      console.log("No config.yaml found, using default sequential processing");
      return DEFAULT_CONFIG;
    }

    const fileContents = fs.readFileSync(configPath, "utf8");
    const yamlConfig = yaml.load(fileContents) as Partial<FullConfig>;

    return mergeWithDefaults(yamlConfig);
  } catch (error) {
    console.warn(
      `Warning: Failed to parse config.yaml: ${error}. Using defaults.`
    );
    return DEFAULT_CONFIG;
  }
}

function mergeWithDefaults(yamlConfig: Partial<FullConfig>): ProcessingConfig {
  return {
    parallelProcessing: {
      ...DEFAULT_PARALLEL_CONFIG,
      ...(yamlConfig.parallelProcessing || {}),
    },
    entityConfig: yamlConfig.entityConfig || {},
    entityDependencies: yamlConfig.entityDependencies || {},
  };
}

export function getEntityConfig(
  entityName: string,
  globalConfig: ProcessingConfig
): ParallelProcessingConfig {
  const entityOverrides = globalConfig.entityConfig[entityName] || {};

  let finalConfig = {
    ...globalConfig.parallelProcessing,
    ...entityOverrides,
  };

  // Apply constraint: preserveRowOrder forces concurrency = 1
  if (finalConfig.preserveRowOrder && finalConfig.concurrency > 1) {
    console.warn(
      `Entity '${entityName}': preserveRowOrder=true forces concurrency=1 (was ${finalConfig.concurrency})`
    );
    finalConfig.concurrency = 1;
  }

  return finalConfig;
}
