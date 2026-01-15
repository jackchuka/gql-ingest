import { GQLIngest, GQLIngestOptions } from "./gql-ingest";
import { Logger } from "./logger";
import { ProcessingMetrics } from "./metrics";

// Mock dependencies
jest.mock("./graphql-client");
jest.mock("./mapper");
jest.mock("./metrics");
jest.mock("./dependency-resolver");
jest.mock("./config");

import { GraphQLClientWrapper } from "./graphql-client";
import { DataMapper } from "./mapper";
import { MetricsCollector } from "./metrics";
import { DependencyResolver } from "./dependency-resolver";
import { loadConfig, getEntityConfig, getRetryConfig } from "./config";

const MockGraphQLClientWrapper = GraphQLClientWrapper as jest.MockedClass<
  typeof GraphQLClientWrapper
>;
const MockDataMapper = DataMapper as jest.MockedClass<typeof DataMapper>;
const MockMetricsCollector = MetricsCollector as jest.MockedClass<typeof MetricsCollector>;
const MockDependencyResolver = DependencyResolver as jest.MockedClass<typeof DependencyResolver>;
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockGetEntityConfig = getEntityConfig as jest.MockedFunction<typeof getEntityConfig>;
const mockGetRetryConfig = getRetryConfig as jest.MockedFunction<typeof getRetryConfig>;

describe("GQLIngest", () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockMetricsInstance: jest.Mocked<MetricsCollector>;
  let mockMapperInstance: jest.Mocked<DataMapper>;
  let mockClientInstance: jest.Mocked<GraphQLClientWrapper>;
  let mockResolverInstance: jest.Mocked<DependencyResolver>;

  // Store mock functions separately to avoid unbound-method lint warnings
  let discoverMappingsMock: jest.Mock;
  let processEntityMock: jest.Mock;
  let finishProcessingMock: jest.Mock;

  const defaultOptions: GQLIngestOptions = {
    endpoint: "https://api.example.com/graphql",
  };

  const defaultMetrics: ProcessingMetrics = {
    totalRows: 0,
    successfulOperations: 0,
    failedOperations: 0,
    totalDuration: 0,
    entities: {},
  };

  const defaultConfig = {
    retry: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      exponentialBackoff: true,
      retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    },
    parallelProcessing: {
      concurrency: 1,
      entityConcurrency: 1,
      preserveRowOrder: true,
    },
    entityConfig: {},
    entityDependencies: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Setup mock functions
    discoverMappingsMock = jest.fn();
    processEntityMock = jest.fn();
    finishProcessingMock = jest.fn();

    // Setup MetricsCollector mock
    mockMetricsInstance = {
      startEntityProcessing: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      finishEntityProcessing: jest.fn(),
      finishProcessing: finishProcessingMock,
      getMetrics: jest.fn().mockReturnValue(defaultMetrics),
      generateSummary: jest.fn().mockReturnValue("Metrics Summary"),
    } as any;

    MockMetricsCollector.mockImplementation(() => mockMetricsInstance);

    // Setup GraphQLClientWrapper mock
    mockClientInstance = {
      executeMutation: jest.fn(),
      setHeaders: jest.fn(),
    } as any;

    MockGraphQLClientWrapper.mockImplementation(() => mockClientInstance);

    // Setup DataMapper mock
    mockMapperInstance = {
      discoverMappings: discoverMappingsMock,
      processEntity: processEntityMock,
      getMetrics: jest.fn(),
    } as any;

    MockDataMapper.mockImplementation(() => mockMapperInstance);

    // Setup DependencyResolver mock
    mockResolverInstance = {
      resolveExecutionOrder: jest.fn().mockReturnValue([]),
      validateDependencies: jest.fn().mockReturnValue([]),
    } as any;

    MockDependencyResolver.mockImplementation(() => mockResolverInstance);

    // Setup config mocks
    mockLoadConfig.mockReturnValue(defaultConfig);
    mockGetEntityConfig.mockReturnValue(defaultConfig.parallelProcessing);
    mockGetRetryConfig.mockReturnValue(defaultConfig.retry);
  });

  describe("constructor", () => {
    it("should create instance with minimal options", () => {
      const ingest = new GQLIngest(defaultOptions);

      expect(ingest).toBeInstanceOf(GQLIngest);
      expect(MockGraphQLClientWrapper).toHaveBeenCalledWith(
        "https://api.example.com/graphql",
        {},
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should create instance with custom headers", () => {
      const options: GQLIngestOptions = {
        ...defaultOptions,
        headers: { Authorization: "Bearer token123" },
      };

      new GQLIngest(options);

      expect(MockGraphQLClientWrapper).toHaveBeenCalledWith(
        "https://api.example.com/graphql",
        { Authorization: "Bearer token123" },
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should create instance with custom logger", () => {
      const options: GQLIngestOptions = {
        ...defaultOptions,
        logger: mockLogger,
      };

      new GQLIngest(options);

      expect(MockDataMapper).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        mockLogger,
        undefined,
      );
    });

    it("should create instance with format override", () => {
      const options: GQLIngestOptions = {
        ...defaultOptions,
        formatOverride: "json",
      };

      new GQLIngest(options);

      expect(MockDataMapper).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        "json",
      );
    });
  });

  describe("ingest", () => {
    it("should successfully ingest data from config path", async () => {
      discoverMappingsMock.mockReturnValue([
        "/path/mappings/users.json",
        "/path/mappings/orders.json",
      ]);

      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users", "orders"] },
      ]);

      mockResolverInstance.validateDependencies.mockReturnValue([]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      expect(result.success).toBe(true);
      expect(result.metrics).toEqual(defaultMetrics);
      expect(result.errors).toBeUndefined();
      expect(mockLoadConfig).toHaveBeenCalledWith("/path/to/config", mockLogger);
    });

    it("should return error when no mapping files found", async () => {
      discoverMappingsMock.mockReturnValue([]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("No mapping files found")]),
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should filter entities when entities option is provided as array", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config", { entities: ["users"] });

      expect(discoverMappingsMock).toHaveBeenCalledWith("/path/to/config", ["users"]);
    });

    it("should filter entities when entities option is provided as comma-separated string", async () => {
      discoverMappingsMock.mockReturnValue([
        "/path/mappings/users.json",
        "/path/mappings/orders.json",
      ]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users", "orders"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config", { entities: "users, orders" });

      expect(discoverMappingsMock).toHaveBeenCalledWith("/path/to/config", ["users", "orders"]);
    });

    it("should use format override from ingest options", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest(defaultOptions);
      await ingest.ingest("/path/to/config", { format: "yaml" });

      // The second DataMapper instantiation (in ingest) should use the format
      expect(MockDataMapper).toHaveBeenLastCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        "yaml",
      );
    });

    it("should return errors when dependency validation fails without entity filter", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.validateDependencies.mockReturnValue([
        "Entity 'orders' depends on 'users' which is not in the entity list",
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "Entity 'orders' depends on 'users' which is not in the entity list",
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should warn but continue when dependency validation fails with entity filter", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.validateDependencies.mockReturnValue(["Missing dependency warning"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config", { entities: ["users"] });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Dependency validation issues"),
      );
    });

    it("should handle exceptions during ingestion", async () => {
      discoverMappingsMock.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Unexpected error");
      expect(mockLogger.error).toHaveBeenCalledWith("Error: Unexpected error");
    });

    it("should process entities in dependency waves", async () => {
      discoverMappingsMock.mockReturnValue([
        "/path/mappings/users.json",
        "/path/mappings/orders.json",
        "/path/mappings/payments.json",
      ]);

      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
        { wave: 1, entities: ["orders", "payments"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        entityDependencies: {
          orders: ["users"],
          payments: ["users"],
        },
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config");

      expect(mockLogger.info).toHaveBeenCalledWith("Processing 2 dependency waves...");
      expect(mockLogger.info).toHaveBeenCalledWith("Wave 1: Processing entities [users]");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Wave 2: Processing entities [orders, payments]",
      );
    });

    it("should call finishProcessing on metrics collector after successful ingest", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config");

      expect(finishProcessingMock).toHaveBeenCalled();
    });

    it("should handle entity processing errors gracefully", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);
      processEntityMock.mockRejectedValue(new Error("Processing failed"));

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      // Should still succeed overall as errors are caught per-entity
      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Could not process"),
      );
    });
  });

  describe("ingestEntities", () => {
    it("should call ingest with entities option", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingestEntities("/path/to/config", ["users", "orders"]);

      expect(discoverMappingsMock).toHaveBeenCalledWith("/path/to/config", ["users", "orders"]);
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("metrics");
    });
  });

  describe("getMetrics", () => {
    it("should return current processing metrics", () => {
      const expectedMetrics: ProcessingMetrics = {
        totalRows: 100,
        successfulOperations: 95,
        failedOperations: 5,
        totalDuration: 5000,
        entities: {
          users: {
            rowsProcessed: 50,
            successfulRows: 48,
            failedRows: 2,
            duration: 2500,
          },
        },
      };

      mockMetricsInstance.getMetrics.mockReturnValue(expectedMetrics);

      const ingest = new GQLIngest(defaultOptions);
      const metrics = ingest.getMetrics();

      expect(metrics).toEqual(expectedMetrics);
    });
  });

  describe("getMetricsSummary", () => {
    it("should return formatted metrics summary", () => {
      const expectedSummary = `
Processing Complete:
  Total: 100 processed (95 successes, 5 failures)
  Success Rate: 95%
  Duration: 5.0s
      `.trim();

      mockMetricsInstance.generateSummary.mockReturnValue(expectedSummary);

      const ingest = new GQLIngest(defaultOptions);
      const summary = ingest.getMetricsSummary();

      expect(summary).toBe(expectedSummary);
    });
  });

  describe("getClient", () => {
    it("should return the GraphQL client wrapper", () => {
      const ingest = new GQLIngest(defaultOptions);
      const client = ingest.getClient();

      expect(client).toBe(mockClientInstance);
    });
  });

  describe("getMapper", () => {
    it("should return the data mapper", () => {
      const ingest = new GQLIngest(defaultOptions);
      const mapper = ingest.getMapper();

      expect(mapper).toBe(mockMapperInstance);
    });
  });

  describe("setLogger", () => {
    it("should update the logger and recreate components", () => {
      const ingest = new GQLIngest(defaultOptions);

      // Clear mock call counts from constructor
      MockGraphQLClientWrapper.mockClear();
      MockDataMapper.mockClear();

      ingest.setLogger(mockLogger);

      // Should create new client and mapper with the new logger
      expect(MockGraphQLClientWrapper).toHaveBeenCalledWith(
        "https://api.example.com/graphql",
        {},
        expect.any(Object),
        mockLogger,
      );

      expect(MockDataMapper).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        mockLogger,
        undefined,
      );
    });
  });

  describe("setHeaders", () => {
    it("should update headers and recreate components", () => {
      const ingest = new GQLIngest(defaultOptions);

      // Clear mock call counts from constructor
      MockGraphQLClientWrapper.mockClear();
      MockDataMapper.mockClear();

      const newHeaders = { "X-API-Key": "new-api-key" };
      ingest.setHeaders(newHeaders);

      // Should create new client with the new headers
      expect(MockGraphQLClientWrapper).toHaveBeenCalledWith(
        "https://api.example.com/graphql",
        newHeaders,
        expect.any(Object),
        expect.any(Object),
      );

      expect(MockDataMapper).toHaveBeenCalled();
    });
  });

  describe("dependency resolution", () => {
    it("should filter dependencies to only relevant entities", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/orders.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["orders"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        entityDependencies: {
          orders: ["users"],
          payments: ["orders"],
          shipments: ["orders"],
        },
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config", { entities: ["orders"] });

      // DependencyResolver should only receive dependencies for the filtered entities
      expect(MockDependencyResolver).toHaveBeenCalledWith(
        ["orders"],
        { orders: ["users"] }, // Only orders dependency, not payments or shipments
        true, // allowPartialResolution = true because entity filter is set
      );
    });

    it("should pass allowPartialResolution=false when no entity filter", async () => {
      discoverMappingsMock.mockReturnValue([
        "/path/mappings/users.json",
        "/path/mappings/orders.json",
      ]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
        { wave: 1, entities: ["orders"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        entityDependencies: {
          orders: ["users"],
        },
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config");

      expect(MockDependencyResolver).toHaveBeenCalledWith(
        ["users", "orders"],
        { orders: ["users"] },
        false, // allowPartialResolution = false
      );
    });
  });

  describe("entity concurrency", () => {
    it("should respect entityConcurrency configuration", async () => {
      discoverMappingsMock.mockReturnValue([
        "/path/mappings/entity1.json",
        "/path/mappings/entity2.json",
        "/path/mappings/entity3.json",
        "/path/mappings/entity4.json",
      ]);

      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["entity1", "entity2", "entity3", "entity4"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        parallelProcessing: {
          ...defaultConfig.parallelProcessing,
          entityConcurrency: 2, // Process 2 entities at a time
        },
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest("/path/to/config");

      // All 4 entities should be processed
      expect(processEntityMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("edge cases", () => {
    it("should handle non-Error exceptions", async () => {
      discoverMappingsMock.mockImplementation(() => {
        throw "String error"; // Non-Error exception
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      expect(result.success).toBe(false);
      expect(result.errors).toContain("String error");
    });

    it("should reset metrics for each ingest call", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest(defaultOptions);

      // First ingest
      await ingest.ingest("/path/to/config");

      // Second ingest
      await ingest.ingest("/path/to/config");

      // MetricsCollector should be instantiated for each ingest call
      // (once in constructor + twice for ingest calls)
      expect(MockMetricsCollector).toHaveBeenCalledTimes(3);
    });

    it("should handle empty entity dependencies", async () => {
      discoverMappingsMock.mockReturnValue(["/path/mappings/users.json"]);
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        entityDependencies: {}, // Empty dependencies
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest("/path/to/config");

      expect(result.success).toBe(true);
      expect(MockDependencyResolver).toHaveBeenCalledWith(["users"], {}, false);
    });
  });
});
