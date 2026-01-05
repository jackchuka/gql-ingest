import fs from "fs";
import { loadConfig, getEntityConfig, getRetryConfig, DEFAULT_CONFIG } from "./config";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("Configuration", () => {
  const testConfigDir = "/test/config";

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("loadConfig", () => {
    it("should return default config when no config.yaml exists", () => {
      mockFs.existsSync.mockReturnValue(false);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const config = loadConfig(testConfigDir);

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        "No config.yaml found, using default sequential processing",
      );

      consoleSpy.mockRestore();
    });

    it("should load and merge YAML configuration", () => {
      const yamlContent = `
parallelProcessing:
  concurrency: 5
  entityConcurrency: 3

entityConfig:
  users:
    concurrency: 2
    preserveRowOrder: true

entityDependencies:
  products: ["users"]
`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig(testConfigDir);

      expect(config.parallelProcessing.concurrency).toBe(5);
      expect(config.parallelProcessing.entityConcurrency).toBe(3);
      expect(config.entityConfig.users.concurrency).toBe(2);
      expect(config.entityConfig.users.preserveRowOrder).toBe(true);
      expect(config.entityDependencies.products).toEqual(["users"]);
    });

    it("should merge partial configuration with defaults", () => {
      const yamlContent = `
parallelProcessing:
  concurrency: 10
entityConfig:
  products:
    concurrency: 20
`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig(testConfigDir);

      // Should merge with defaults
      expect(config.parallelProcessing.concurrency).toBe(10);
      expect(config.parallelProcessing.entityConcurrency).toBe(1); // default
      expect(config.parallelProcessing.preserveRowOrder).toBe(true); // default
    });

    it("should handle invalid YAML gracefully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("invalid: yaml: content: [");

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const config = loadConfig(testConfigDir);

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Failed to parse config.yaml"),
      );

      consoleSpy.mockRestore();
    });

    it("should handle file read errors gracefully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("File read error");
      });

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const config = loadConfig(testConfigDir);

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Failed to parse config.yaml"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getEntityConfig", () => {
    const globalConfig = {
      retry: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        exponentialBackoff: true,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      },
      parallelProcessing: {
        concurrency: 10,
        entityConcurrency: 3,
        preserveRowOrder: false,
      },
      entityConfig: {
        users: {
          concurrency: 2,
          preserveRowOrder: true,
        },
        products: {
          concurrency: 20,
        },
      },
      entityDependencies: {},
    };

    it("should return global config for entity without overrides", () => {
      const entityConfig = getEntityConfig("orders", globalConfig);

      expect(entityConfig).toEqual(globalConfig.parallelProcessing);
    });

    it("should merge entity overrides with global config", () => {
      const entityConfig = getEntityConfig("products", globalConfig);

      expect(entityConfig.concurrency).toBe(20); // overridden
      expect(entityConfig.entityConcurrency).toBe(3); // from global
      expect(entityConfig.preserveRowOrder).toBe(false); // from global
    });

    it("should apply preserveRowOrder constraint", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const entityConfig = getEntityConfig("users", globalConfig);

      expect(entityConfig.concurrency).toBe(1); // forced to 1
      expect(entityConfig.preserveRowOrder).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Entity 'users': preserveRowOrder=true forces concurrency=1 (was 2)",
      );

      consoleSpy.mockRestore();
    });

    it("should not apply constraint when concurrency is already 1", () => {
      const config = {
        ...globalConfig,
        entityConfig: {
          ...globalConfig.entityConfig,
          sequential: {
            concurrency: 1,
            preserveRowOrder: true,
          },
        },
      };

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const entityConfig = getEntityConfig("sequential", config);

      expect(entityConfig.concurrency).toBe(1);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should not apply constraint when preserveRowOrder is false", () => {
      const config = {
        ...globalConfig,
        entityConfig: {
          ...globalConfig.entityConfig,
          bulk: {
            concurrency: 50,
            preserveRowOrder: false,
          },
        },
      };

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const entityConfig = getEntityConfig("bulk", config);

      expect(entityConfig.concurrency).toBe(50);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("getRetryConfig", () => {
    const globalConfig = {
      retry: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        exponentialBackoff: true,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      },
      parallelProcessing: {
        concurrency: 10,
        entityConcurrency: 3,
        preserveRowOrder: false,
      },
      entityConfig: {
        important: {
          retry: {
            maxAttempts: 5,
            baseDelay: 500,
          },
        },
        fast: {
          retry: {
            maxAttempts: 1,
          },
        },
      },
      entityDependencies: {},
    };

    it("should return global retry config for entity without overrides", () => {
      const retryConfig = getRetryConfig("regular", globalConfig);

      expect(retryConfig).toEqual(globalConfig.retry);
    });

    it("should merge entity retry overrides with global config", () => {
      const retryConfig = getRetryConfig("important", globalConfig);

      expect(retryConfig.maxAttempts).toBe(5); // overridden
      expect(retryConfig.baseDelay).toBe(500); // overridden
      expect(retryConfig.maxDelay).toBe(30000); // from global
      expect(retryConfig.exponentialBackoff).toBe(true); // from global
      expect(retryConfig.retryableStatusCodes).toEqual([408, 429, 500, 502, 503, 504]); // from global
    });

    it("should handle partial retry overrides", () => {
      const retryConfig = getRetryConfig("fast", globalConfig);

      expect(retryConfig.maxAttempts).toBe(1); // overridden
      expect(retryConfig.baseDelay).toBe(1000); // from global
      expect(retryConfig.maxDelay).toBe(30000); // from global
    });

    it("should handle entity with no retry config", () => {
      const retryConfig = getRetryConfig("undefined-entity", globalConfig);

      expect(retryConfig).toEqual(globalConfig.retry);
    });
  });
});
