import fs from "fs";
import path from "path";
import { DataMapper } from "./mapper";
import { GraphQLClientWrapper } from "./graphql-client";
import { MetricsCollector } from "./metrics";

jest.mock("fs");
jest.mock("./readers", () => ({
  ...jest.requireActual("./readers"),
  readCsvFile: jest.fn(),
  DataReaderFactory: {
    getReader: jest.fn().mockReturnValue({
      readFile: jest.fn(),
    }),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe("DataMapper", () => {
  let mockClient: jest.Mocked<GraphQLClientWrapper>;
  let mockMetrics: jest.Mocked<MetricsCollector>;
  let dataMapper: DataMapper;
  let executeMutation: jest.Mock;
  let setHeaders: jest.Mock;
  let startEntityProcessing: jest.Mock;
  let recordSuccess: jest.Mock;
  let recordFailure: jest.Mock;
  let finishEntityProcessing: jest.Mock;
  let getMetrics: jest.Mock;
  const testBasePath = "/test/base/path";

  beforeEach(() => {
    executeMutation = jest.fn();
    setHeaders = jest.fn();
    mockClient = {
      executeMutation,
      setHeaders,
    } as any;

    startEntityProcessing = jest.fn();
    recordSuccess = jest.fn();
    recordFailure = jest.fn();
    finishEntityProcessing = jest.fn();
    getMetrics = jest.fn();
    mockMetrics = {
      startEntityProcessing,
      recordSuccess,
      recordFailure,
      finishEntityProcessing,
      getMetrics,
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
        path.resolve(testBasePath, "configs/test", "mappings"),
      );
      expect(result).toEqual([
        "configs/test/mappings/items.json",
        "configs/test/mappings/orders.json",
        "configs/test/mappings/users.json",
      ]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Discovered 3 mapping files: items.json, orders.json, users.json",
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
        expect.any(Error),
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

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createUser: { id: "123" },
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test/mappings/users.json"),
        "utf8",
      );
      expect(DataReaderFactory.getReader).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test", "data/users.csv"),
        undefined,
      );
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test", "graphql/users.graphql"),
        "utf8",
      );

      expect(executeMutation).toHaveBeenCalledTimes(2);
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "John",
          email: "john@example.com",
        },
        undefined,
      );
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Jane",
          email: "jane@example.com",
        },
        undefined,
      );

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

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockRejectedValue(new Error("GraphQL error"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(consoleSpy).toHaveBeenCalledWith(
        "✗ Failed to create entity for row 1:",
        { user_name: "John" },
        expect.any(Error),
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

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "456" },
      });

      await dataMapper.processEntity("configs/test/mappings/products.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          price: "19.99",
          sku: "W001",
        },
        undefined,
      );
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

      const mockCsvData = [{ user_name: "John", user_email: "john@example.com" }];

      const mockMutation =
        "mutation CreateUser($name: String!, $email: String, $phone: String) { createUser(input: { name: $name, email: $email, phone: $phone }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createUser: { id: "789" },
      });

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "John",
          email: "john@example.com",
        },
        undefined,
      );
    });

    it("should call metrics methods during successful processing", async () => {
      const mockConfig = {
        csvFile: "data/users.csv",
        graphqlFile: "graphql/users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }, { user_name: "Jane" }];
      const mockMutation =
        "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createUser: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(startEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordSuccess).toHaveBeenCalledTimes(2);
      expect(recordSuccess).toHaveBeenCalledWith("users");
      expect(finishEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordFailure).not.toHaveBeenCalled();
    });

    it("should call metrics methods during failed processing", async () => {
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

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockRejectedValue(new Error("GraphQL error"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/users.json");

      expect(startEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordFailure).toHaveBeenCalledTimes(1);
      expect(recordFailure).toHaveBeenCalledWith("users");
      expect(finishEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordSuccess).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should expose metrics through getMetrics method", () => {
      const metrics = dataMapper.getMetrics();
      expect(metrics).toBe(mockMetrics);
    });

    it("should convert numeric types from CSV strings to proper GraphQL types", async () => {
      const mockConfig = {
        csvFile: "data/products.csv",
        graphqlFile: "graphql/products.graphql",
        mapping: {
          name: "product_name",
          price: "product_price",
          quantity: "product_quantity",
          active: "product_active",
        },
      };

      const mockCsvData = [
        {
          product_name: "Widget",
          product_price: "19.99",
          product_quantity: "10",
          product_active: "true",
        },
      ];

      const mockMutation = `
        mutation CreateProduct($name: String!, $price: Float!, $quantity: Int!, $active: Boolean!) {
          createProduct(input: { name: $name, price: $price, quantity: $quantity, active: $active }) {
            id
          }
        }
      `;

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/mappings/products.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          price: 19.99,
          quantity: 10,
          active: true,
        },
        undefined,
      );
    });

    it("should handle invalid numeric conversions gracefully", async () => {
      const mockConfig = {
        csvFile: "data/products.csv",
        graphqlFile: "graphql/products.graphql",
        mapping: {
          name: "product_name",
          price: "product_price",
          quantity: "product_quantity",
        },
      };

      const mockCsvData = [
        {
          product_name: "Widget",
          product_price: "invalid_price",
          product_quantity: "invalid_quantity",
        },
      ];

      const mockMutation = `
        mutation CreateProduct($name: String!, $price: Float!, $quantity: Int!) {
          createProduct(input: { name: $name, price: $price, quantity: $quantity }) {
            id
          }
        }
      `;

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/products.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          price: "invalid_price",
          quantity: "invalid_quantity",
        },
        undefined,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        'Warning: Cannot convert "invalid_price" to Float for variable $price. Expected a valid number. Using original value.',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Warning: Cannot convert "invalid_quantity" to Int for variable $quantity. Expected a valid integer. Using original value.',
      );

      consoleSpy.mockRestore();
    });

    it("should handle edge cases in numeric conversion safely", async () => {
      const mockConfig = {
        csvFile: "data/products.csv",
        graphqlFile: "graphql/products.graphql",
        mapping: {
          int_field: "int_value",
          float_field: "float_value",
        },
      };

      const mockCsvData = [
        {
          int_value: "1.5", // Float in Int field - should remain string
          float_value: "Infinity", // Invalid float - should remain string
        },
        {
          int_value: "not_a_number", // Invalid int - should remain string
          float_value: "1.2.3", // Invalid number format - should remain string
        },
      ];

      const mockMutation = `
        mutation CreateProduct($int_field: Int!, $float_field: Float!) {
          createProduct(input: { int_field: $int_field, float_field: $float_field }) {
            id
          }
        }
      `;

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      await dataMapper.processEntity("configs/test/mappings/products.json");

      // Should keep invalid values as strings
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          int_field: "1.5",
          float_field: "Infinity",
        },
        undefined,
      );

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          int_field: "not_a_number",
          float_field: "1.2.3",
        },
        undefined,
      );

      consoleSpy.mockRestore();
    });

    it("should keep unknown scalar types as strings", async () => {
      const mockConfig = {
        csvFile: "data/products.csv",
        graphqlFile: "graphql/products.graphql",
        mapping: {
          name: "product_name",
          custom_field: "custom_value",
        },
      };

      const mockCsvData = [
        {
          product_name: "Widget",
          custom_value: "123",
        },
      ];

      const mockMutation = `
        mutation CreateProduct($name: String!, $custom_field: CustomScalar!) {
          createProduct(input: { name: $name, custom_field: $custom_field }) {
            id
          }
        }
      `;

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("./readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      // Create verbose mapper to test the logging
      const verboseMapper = new DataMapper(mockClient, testBasePath, mockMetrics, true);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await verboseMapper.processEntity("configs/test/mappings/products.json");

      // Should keep custom scalar as string
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          custom_field: "123",
        },
        undefined,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        'Unknown GraphQL type "CustomScalar" for variable $custom_field. Keeping value as string.',
      );

      consoleSpy.mockRestore();
    });
  });
});
