import { GQLIngest, GQLIngestOptions } from "./gql-ingest";
import { Logger } from "./logger";
import { ProcessingMetrics } from "./metrics";

// Mock dependencies
jest.mock("fs");
jest.mock("./graphql-client");
jest.mock("./mapper");
jest.mock("./metrics");
jest.mock("./dependency-resolver");
jest.mock("./config");

import fs from "fs";
import path from "path";
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
      processEntityWithEvents: processEntityMock,
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

    // Mock fs.readFileSync to return entity configs with name fields
    const mockFs = fs as jest.Mocked<typeof fs>;
    mockFs.readFileSync.mockImplementation((filePath: any) => {
      const dir = path.basename(path.dirname(String(filePath)));
      return JSON.stringify({
        name: dir,
        dataFile: `${dir}.csv`,
        graphqlFile: `${dir}.graphql`,
        mapping: {},
      });
    });
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
    it("should successfully ingest entity files", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users", "orders"] },
      ]);

      mockResolverInstance.validateDependencies.mockReturnValue([]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest(["/path/users/entity.json", "/path/orders/entity.json"]);

      expect(result.success).toBe(true);
      expect(result.metrics).toEqual(defaultMetrics);
      expect(result.errors).toBeUndefined();
      expect(mockLoadConfig).toHaveBeenCalledWith(undefined, mockLogger);
    });

    it("should return error when no entity files provided", async () => {
      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest([]);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("No entity files provided")]),
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should use format override from ingest options", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest(defaultOptions);
      await ingest.ingest(["/path/users/entity.json"], { format: "yaml" });

      // The second DataMapper instantiation (in ingest) should use the format
      expect(MockDataMapper).toHaveBeenLastCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        "yaml",
      );
    });

    it("should return errors when dependency validation fails", async () => {
      mockResolverInstance.validateDependencies.mockReturnValue([
        "Entity 'orders' depends on 'users' which is not in the entity list",
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest(["/path/users/entity.json"]);

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "Entity 'orders' depends on 'users' which is not in the entity list",
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should handle exceptions during ingestion", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);
      processEntityMock.mockRejectedValue(new Error("Unexpected error"));

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest(["/path/users/entity.json"]);

      // Entity-level errors are caught per-entity, so this still succeeds
      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Could not process"),
      );
    });

    it("should process entities in dependency waves", async () => {
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
      await ingest.ingest([
        "/path/users/entity.json",
        "/path/orders/entity.json",
        "/path/payments/entity.json",
      ]);

      expect(mockLogger.info).toHaveBeenCalledWith("Processing 2 dependency waves...");
      expect(mockLogger.info).toHaveBeenCalledWith("Wave 1: Processing entities [users]");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Wave 2: Processing entities [orders, payments]",
      );
    });

    it("should call finishProcessing on metrics collector after successful ingest", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest(["/path/users/entity.json"]);

      expect(finishProcessingMock).toHaveBeenCalled();
    });

    it("should handle entity processing errors gracefully", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);
      processEntityMock.mockRejectedValue(new Error("Processing failed"));

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest(["/path/users/entity.json"]);

      // Should still succeed overall as errors are caught per-entity
      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Could not process"),
      );
    });

    it("should pass config option to loadConfig", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest(["/path/users/entity.json"], { config: "/path/config.yaml" });

      expect(mockLoadConfig).toHaveBeenCalledWith("/path/config.yaml", mockLogger);
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
      await ingest.ingest(["/path/orders/entity.json"]);

      // DependencyResolver should only receive dependencies for the provided entities
      expect(MockDependencyResolver).toHaveBeenCalledWith(["orders"], { orders: ["users"] }, false);
    });

    it("should pass allowPartialResolution=false", async () => {
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
      await ingest.ingest(["/path/users/entity.json", "/path/orders/entity.json"]);

      expect(MockDependencyResolver).toHaveBeenCalledWith(
        ["users", "orders"],
        { orders: ["users"] },
        false,
      );
    });
  });

  describe("entity concurrency", () => {
    it("should respect entityConcurrency configuration", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["entity1", "entity2", "entity3", "entity4"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        parallelProcessing: {
          ...defaultConfig.parallelProcessing,
          entityConcurrency: 2,
        },
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      await ingest.ingest([
        "/path/entity1/entity.json",
        "/path/entity2/entity.json",
        "/path/entity3/entity.json",
        "/path/entity4/entity.json",
      ]);

      // All 4 entities should be processed
      expect(processEntityMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("edge cases", () => {
    it("should handle non-Error exceptions", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);
      processEntityMock.mockImplementation(() => {
        throw "String error"; // Non-Error exception
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest(["/path/users/entity.json"]);

      // Per-entity errors are caught, so overall still succeeds
      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("String error"));
    });

    it("should reset metrics for each ingest call", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      const ingest = new GQLIngest(defaultOptions);

      // First ingest
      await ingest.ingest(["/path/users/entity.json"]);

      // Second ingest
      await ingest.ingest(["/path/users/entity.json"]);

      // MetricsCollector should be instantiated for each ingest call
      // (once in constructor + twice for ingest calls)
      expect(MockMetricsCollector).toHaveBeenCalledTimes(3);
    });

    it("should handle empty entity dependencies", async () => {
      mockResolverInstance.resolveExecutionOrder.mockReturnValue([
        { wave: 0, entities: ["users"] },
      ]);

      mockLoadConfig.mockReturnValue({
        ...defaultConfig,
        entityDependencies: {},
      });

      const ingest = new GQLIngest({ ...defaultOptions, logger: mockLogger });
      const result = await ingest.ingest(["/path/users/entity.json"]);

      expect(result.success).toBe(true);
      expect(MockDependencyResolver).toHaveBeenCalledWith(["users"], {}, false);
    });
  });
});
