import fs from "fs";
import path from "path";
import { DataMapper } from "./mapper";
import { GraphQLClientWrapper } from "./graphql-client";
import { MetricsCollector } from "./metrics";

jest.mock("fs");
jest.mock("./csv-reader");

const mockFs = fs as jest.Mocked<typeof fs>;

describe("DataMapper", () => {
  let mockClient: jest.Mocked<GraphQLClientWrapper>;
  let mockMetrics: jest.Mocked<MetricsCollector>;
  let dataMapper: DataMapper;
  const testBasePath = "/test/base/path";

  beforeEach(() => {
    mockClient = {
      executeMutation: jest.fn(),
      setHeaders: jest.fn(),
    } as any;

    mockMetrics = {
      startEntityProcessing: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      finishEntityProcessing: jest.fn(),
      getMetrics: jest.fn(),
    } as any;

    dataMapper = new DataMapper(mockClient, testBasePath, mockMetrics);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("discoverMappings", () => {
    it("should discover mapping files in alphabetical order", () => {
      const mockFiles = ["users.json", "items.json", "orders.json"];
      mockFs.readdirSync.mockReturnValue(mockFiles as any);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const result = dataMapper.discoverMappings("configs/test");

      expect(mockFs.readdirSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test", "mappings")
      );
      expect(result).toEqual([
        "configs/test/mappings/items.json",
        "configs/test/mappings/orders.json",
        "configs/test/mappings/users.json",
      ]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Discovered 3 mapping files: items.json, orders.json, users.json"
      );

      consoleSpy.mockRestore();
    });

    it("should filter only JSON files", () => {
      const mockFiles = ["users.json", "items.txt", "orders.json", "readme.md"];
      mockFs.readdirSync.mockReturnValue(mockFiles as any);

      const result = dataMapper.discoverMappings("configs/test");

      expect(result).toEqual([
        "configs/test/mappings/orders.json",
        "configs/test/mappings/users.json",
      ]);
    });

    it("should handle directory read errors", () => {
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error("Directory not found");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const result = dataMapper.discoverMappings("configs/nonexistent");

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error reading mappings directory"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("processEntity", () => {
    it("should process entity successfully", async () => {
      const mockConfig = {
        csvFile: "data/users.csv",
        graphqlFile: "graphql/users.graphql",
        mapping: {
          name: "user_name",
          email: "user_email",
        },
      };

      const mockCsvData = [
        { user_name: "John", user_email: "john@example.com" },
        { user_name: "Jane", user_email: "jane@example.com" },
      ];

      const mockMutation =
        "mutation CreateUser($name: String!, $email: String!) { createUser(input: { name: $name, email: $email }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { readCsvFile } = require("./csv-reader");
      readCsvFile.mockResolvedValue(mockCsvData);

      mockClient.executeMutation.mockResolvedValue({
        createUser: { id: "123" },
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test/mappings/users.json"),
        "utf8"
      );
      expect(readCsvFile).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test", "data/users.csv")
      );
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test", "graphql/users.graphql"),
        "utf8"
      );

      expect(mockClient.executeMutation).toHaveBeenCalledTimes(2);
      expect(mockClient.executeMutation).toHaveBeenCalledWith(mockMutation, {
        name: "John",
        email: "john@example.com",
      });
      expect(mockClient.executeMutation).toHaveBeenCalledWith(mockMutation, {
        name: "Jane",
        email: "jane@example.com",
      });

      consoleSpy.mockRestore();
    });

    it("should handle GraphQL execution errors gracefully", async () => {
      const mockConfig = {
        csvFile: "data/users.csv",
        graphqlFile: "graphql/users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }];
      const mockMutation =
        "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { readCsvFile } = require("./csv-reader");
      readCsvFile.mockResolvedValue(mockCsvData);

      mockClient.executeMutation.mockRejectedValue(new Error("GraphQL error"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(consoleSpy).toHaveBeenCalledWith(
        "✗ Failed to create entity for row:",
        { user_name: "John" },
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should map CSV columns to GraphQL variables correctly", async () => {
      const mockConfig = {
        csvFile: "data/products.csv",
        graphqlFile: "graphql/products.graphql",
        mapping: {
          name: "product_name",
          price: "product_price",
          sku: "product_sku",
        },
      };

      const mockCsvData = [
        {
          product_name: "Widget",
          product_price: "19.99",
          product_sku: "W001",
          extra_column: "ignored",
        },
      ];

      const mockMutation =
        "mutation CreateProduct($name: String!, $price: String!, $sku: String!) { createProduct(input: { name: $name, price: $price, sku: $sku }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { readCsvFile } = require("./csv-reader");
      readCsvFile.mockResolvedValue(mockCsvData);

      mockClient.executeMutation.mockResolvedValue({
        createProduct: { id: "456" },
      });

      await dataMapper.processEntity("configs/test/mappings/products.json");

      expect(mockClient.executeMutation).toHaveBeenCalledWith(mockMutation, {
        name: "Widget",
        price: "19.99",
        sku: "W001",
      });
    });

    it("should handle missing CSV columns gracefully", async () => {
      const mockConfig = {
        csvFile: "data/users.csv",
        graphqlFile: "graphql/users.graphql",
        mapping: {
          name: "user_name",
          email: "user_email",
          phone: "user_phone",
        },
      };

      const mockCsvData = [
        { user_name: "John", user_email: "john@example.com" },
      ];

      const mockMutation =
        "mutation CreateUser($name: String!, $email: String, $phone: String) { createUser(input: { name: $name, email: $email, phone: $phone }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { readCsvFile } = require("./csv-reader");
      readCsvFile.mockResolvedValue(mockCsvData);

      mockClient.executeMutation.mockResolvedValue({
        createUser: { id: "789" },
      });

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(mockClient.executeMutation).toHaveBeenCalledWith(mockMutation, {
        name: "John",
        email: "john@example.com",
      });
    });

    it("should call metrics methods during successful processing", async () => {
      const mockConfig = {
        csvFile: "data/users.csv",
        graphqlFile: "graphql/users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }, { user_name: "Jane" }];
      const mockMutation = "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { readCsvFile } = require("./csv-reader");
      readCsvFile.mockResolvedValue(mockCsvData);

      mockClient.executeMutation.mockResolvedValue({ createUser: { id: "123" } });

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(mockMetrics.startEntityProcessing).toHaveBeenCalledWith("users");
      expect(mockMetrics.recordSuccess).toHaveBeenCalledTimes(2);
      expect(mockMetrics.recordSuccess).toHaveBeenCalledWith("users");
      expect(mockMetrics.finishEntityProcessing).toHaveBeenCalledWith("users");
      expect(mockMetrics.recordFailure).not.toHaveBeenCalled();
    });

    it("should call metrics methods during failed processing", async () => {
      const mockConfig = {
        csvFile: "data/users.csv",
        graphqlFile: "graphql/users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }];
      const mockMutation = "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { readCsvFile } = require("./csv-reader");
      readCsvFile.mockResolvedValue(mockCsvData);

      mockClient.executeMutation.mockRejectedValue(new Error("GraphQL error"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(mockMetrics.startEntityProcessing).toHaveBeenCalledWith("users");
      expect(mockMetrics.recordFailure).toHaveBeenCalledTimes(1);
      expect(mockMetrics.recordFailure).toHaveBeenCalledWith("users");
      expect(mockMetrics.finishEntityProcessing).toHaveBeenCalledWith("users");
      expect(mockMetrics.recordSuccess).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should expose metrics through getMetrics method", () => {
      const metrics = dataMapper.getMetrics();
      expect(metrics).toBe(mockMetrics);
    });
  });
});
