import { z } from "zod/v4";

export const RetryConfigSchema = z.object({
  maxAttempts: z.number().describe("Maximum retry attempts before giving up"),
  baseDelay: z.number().describe("Initial delay in ms between retries"),
  maxDelay: z.number().describe("Maximum delay in ms between retries"),
  exponentialBackoff: z.boolean().describe("Use exponential backoff for retry delays"),
  retryableStatusCodes: z.array(z.number()).describe("HTTP status codes that trigger retries"),
});

export const ParallelProcessingConfigSchema = z.object({
  concurrency: z.number().describe("Number of concurrent requests across all entities"),
  entityConcurrency: z.number().describe("Number of concurrent rows processed per entity"),
  preserveRowOrder: z.boolean().describe("Process rows in order (forces concurrency=1 when true)"),
});

export const EntityConfigSchema = z.object({
  concurrency: z.number().optional().describe("Per-entity concurrency override"),
  preserveRowOrder: z.boolean().optional().describe("Per-entity row order override"),
  retry: RetryConfigSchema.partial().optional().describe("Per-entity retry config override"),
});

export const ConfigSchema = z.object({
  retry: RetryConfigSchema,
  parallelProcessing: ParallelProcessingConfigSchema,
  entityConfig: z
    .record(z.string(), EntityConfigSchema)
    .describe("Per-entity configuration overrides"),
  entityDependencies: z
    .record(z.string(), z.array(z.string()))
    .describe("Entity processing order dependencies"),
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;
export type ParallelProcessingConfig = z.infer<typeof ParallelProcessingConfigSchema>;
export type EntityConfig = z.infer<typeof EntityConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// Defaults
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

// Single export for template generation
export const CONFIG_TEMPLATE = {
  schema: {
    parallelProcessing: ParallelProcessingConfigSchema,
    retry: RetryConfigSchema,
    entityConfig: ConfigSchema.shape.entityConfig,
    entityDependencies: ConfigSchema.shape.entityDependencies,
  },
  defaults: {
    parallelProcessing: DEFAULT_PARALLEL_CONFIG,
    retry: DEFAULT_RETRY_CONFIG,
  },
  examples: {
    entityConfig: {
      users: {
        concurrency: 5,
        preserveRowOrder: false,
        retry: { maxAttempts: 5 },
      },
    } as Record<string, EntityConfig>,
    entityDependencies: {
      orders: ["users", "products"],
    } as Record<string, string[]>,
  },
};
