import fs from "fs";
import path from "path";
import { DataMapper, OutputStore } from "./mapper";
import { GraphQLClientWrapper } from "./graphql-client";
import { MetricsCollector } from "./metrics";
import { Logger } from "./logger";

jest.mock("fs");
jest.mock("../readers", () => ({
  ...jest.requireActual("../readers"),
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
  let mockLogger: jest.Mocked<Logger>;
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
      getEntityMetrics: jest.fn().mockReturnValue({
        entityName: "test",
        successCount: 0,
        failureCount: 0,
        startTime: Date.now(),
      }),
    } as any;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    dataMapper = new DataMapper(mockClient, testBasePath, mockMetrics, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("processEntity", () => {
    it("should process entity successfully", async () => {
      const mockConfig = {
        name: "users",
        dataFile: "users.csv",
        graphqlFile: "users.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createUser: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/users/entity.json");

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test/users/entity.json"),
        "utf8",
      );
      expect(DataReaderFactory.getReader).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test/users", "users.csv"),
        undefined,
      );
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.resolve(testBasePath, "configs/test/users", "users.graphql"),
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
        undefined,
      );
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Jane",
          email: "jane@example.com",
        },
        undefined,
        undefined,
      );
    });

    it("should handle GraphQL execution errors gracefully", async () => {
      const mockConfig = {
        name: "users",
        dataFile: "users.csv",
        graphqlFile: "users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }];
      const mockMutation =
        "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockRejectedValue(new Error("GraphQL error"));

      await dataMapper.processEntity("configs/test/users/entity.json");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "✗ Failed to create entity for row 1",
        { user_name: "John" },
        expect.any(Error),
      );
    });

    it("should map CSV columns to GraphQL variables correctly", async () => {
      const mockConfig = {
        name: "products",
        dataFile: "products.csv",
        graphqlFile: "products.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "456" },
      });

      await dataMapper.processEntity("configs/test/products/entity.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          price: "19.99",
          sku: "W001",
        },
        undefined,
        undefined,
      );
    });

    it("should handle missing CSV columns gracefully", async () => {
      const mockConfig = {
        name: "users",
        dataFile: "users.csv",
        graphqlFile: "users.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createUser: { id: "789" },
      });

      await dataMapper.processEntity("configs/test/users/entity.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "John",
          email: "john@example.com",
        },
        undefined,
        undefined,
      );
    });

    it("should call metrics methods during successful processing", async () => {
      const mockConfig = {
        name: "users",
        dataFile: "users.csv",
        graphqlFile: "users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }, { user_name: "Jane" }];
      const mockMutation =
        "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createUser: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/users/entity.json");

      expect(startEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordSuccess).toHaveBeenCalledTimes(2);
      expect(recordSuccess).toHaveBeenCalledWith("users");
      expect(finishEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordFailure).not.toHaveBeenCalled();
    });

    it("should call metrics methods during failed processing", async () => {
      const mockConfig = {
        name: "users",
        dataFile: "users.csv",
        graphqlFile: "users.graphql",
        mapping: { name: "user_name" },
      };

      const mockCsvData = [{ user_name: "John" }];
      const mockMutation =
        "mutation CreateUser($name: String!) { createUser(input: { name: $name }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockRejectedValue(new Error("GraphQL error"));

      await dataMapper.processEntity("configs/test/users/entity.json");

      expect(startEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordFailure).toHaveBeenCalledTimes(1);
      expect(recordFailure).toHaveBeenCalledWith("users");
      expect(finishEntityProcessing).toHaveBeenCalledWith("users");
      expect(recordSuccess).not.toHaveBeenCalled();
    });

    it("should expose metrics through getMetrics method", () => {
      const metrics = dataMapper.getMetrics();
      expect(metrics).toBe(mockMetrics);
    });

    it("should resolve $ref mapping with a pre-populated outputStore", async () => {
      const mockConfig = {
        name: "BusinessPartner",
        dataFile: "data.jsonl",
        graphqlFile: "mutation.graphql",
        mapping: {
          name: "$.name",
          companyId: { $ref: "Company", key: "$.companyRef", field: "id" },
        },
      };

      const mockData = [{ name: "Partner A", companyRef: "Acme Corp" }];

      const mockMutation =
        "mutation CreateBP($name: String!, $companyId: String!) { createBP(input: { name: $name, companyId: $companyId }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockData);

      executeMutation.mockResolvedValue({ createBP: { id: "bp-1" } });

      // Pre-populate outputStore
      const outputStore: OutputStore = new Map();
      outputStore.set("Company", new Map([["Acme Corp", { id: "company-uuid-123" }]]));

      await dataMapper.processEntityWithEvents(
        "configs/test/bp/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Partner A",
          companyId: "company-uuid-123",
        },
        undefined,
        undefined,
      );
    });

    it("should skip the row as a failure when $ref lookup fails", async () => {
      const mockConfig = {
        name: "BusinessPartner",
        dataFile: "data.jsonl",
        graphqlFile: "mutation.graphql",
        mapping: {
          name: "$.name",
          companyId: { $ref: "Company", key: "$.companyRef", field: "id" },
        },
      };

      const mockData = [{ name: "Partner A", companyRef: "NonExistent Corp" }];

      const mockMutation =
        "mutation CreateBP($name: String!, $companyId: String!) { createBP(input: { name: $name, companyId: $companyId }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockData);

      // outputStore with Company but without the key "NonExistent Corp"
      const outputStore: OutputStore = new Map();
      outputStore.set("Company", new Map([["Acme Corp", { id: "company-uuid-123" }]]));

      await dataMapper.processEntityWithEvents(
        "configs/test/bp/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      // Mutation should not be called — the row is skipped as a failure
      expect(executeMutation).not.toHaveBeenCalled();

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create entity for row 1"),
        expect.anything(),
        expect.any(Error),
      );
    });

    it("should capture output from mutation response when outputCapture is configured", async () => {
      const mockConfig = {
        name: "Company",
        dataFile: "data.jsonl",
        graphqlFile: "mutation.graphql",
        outputCapture: {
          key: "$.legalName",
          fields: { id: "$.createCompany.id" },
        },
        mapping: {
          legalName: "$.legalName",
        },
      };

      const mockData = [{ legalName: "Acme Corp" }, { legalName: "Beta Inc" }];

      const mockMutation =
        "mutation CreateCompany($legalName: String!) { createCompany(input: { legalName: $legalName }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockData);

      executeMutation
        .mockResolvedValueOnce({ createCompany: { id: "uuid-acme" } })
        .mockResolvedValueOnce({ createCompany: { id: "uuid-beta" } });

      const outputStore: OutputStore = new Map();

      await dataMapper.processEntityWithEvents(
        "configs/test/company/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      // Verify the output store was populated
      expect(outputStore.get("Company")?.get("Acme Corp")).toEqual({ id: "uuid-acme" });
      expect(outputStore.get("Company")?.get("Beta Inc")).toEqual({ id: "uuid-beta" });
    });

    it("should support end-to-end: entity A captures output, entity B resolves $ref", async () => {
      const outputStore: OutputStore = new Map();

      // --- Process Entity A (Company) ---
      const companyConfig = {
        name: "Company",
        dataFile: "data.jsonl",
        graphqlFile: "mutation.graphql",
        outputCapture: {
          key: "$.legalName",
          fields: { id: "$.createCompany.id" },
        },
        mapping: {
          legalName: "$.legalName",
        },
      };

      const companyData = [{ legalName: "Acme Corp" }];
      const companyMutation =
        "mutation CreateCompany($legalName: String!) { createCompany(input: { legalName: $legalName }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(companyConfig))
        .mockReturnValueOnce(companyMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(companyData);

      executeMutation.mockResolvedValueOnce({ createCompany: { id: "uuid-acme" } });

      await dataMapper.processEntityWithEvents(
        "configs/test/company/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      // --- Process Entity B (BusinessPartner) ---
      const bpConfig = {
        name: "BusinessPartner",
        dataFile: "data.jsonl",
        graphqlFile: "mutation.graphql",
        mapping: {
          name: "$.name",
          companyId: { $ref: "Company", key: "$.companyRef", field: "id" },
        },
      };

      const bpData = [{ name: "Partner A", companyRef: "Acme Corp" }];
      const bpMutation =
        "mutation CreateBP($name: String!, $companyId: String!) { createBP(input: { name: $name, companyId: $companyId }) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(bpConfig))
        .mockReturnValueOnce(bpMutation);

      DataReaderFactory.getReader().readFile.mockResolvedValue(bpData);

      executeMutation.mockResolvedValueOnce({ createBP: { id: "bp-1" } });

      await dataMapper.processEntityWithEvents(
        "configs/test/bp/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      // Entity B should have resolved the $ref to Company's captured id
      expect(executeMutation).toHaveBeenLastCalledWith(
        bpMutation,
        {
          name: "Partner A",
          companyId: "uuid-acme",
        },
        undefined,
        undefined,
      );
    });

    it("should resolve data-level $ref objects embedded inside data values", async () => {
      const mockConfig = {
        name: "orders",
        dataFile: "data.json",
        dataFormat: "json",
        graphqlFile: "mutation.graphql",
        mapping: {
          input: "$",
        },
      };

      const mockData = [
        {
          orderNumber: "ORD-001",
          lines: [
            { sku: "ITEM-A", itemId: { $ref: "items", key: "ITEM-A", field: "id" } },
            { sku: "ITEM-B", itemId: { $ref: "items", key: "ITEM-B", field: "id" } },
          ],
        },
      ];

      const mockMutation =
        "mutation CreateOrder($input: OrderInput!) { createOrder(input: $input) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockData);

      executeMutation.mockResolvedValue({ createOrder: { id: "order-1" } });

      const outputStore: OutputStore = new Map();
      outputStore.set(
        "items",
        new Map([
          ["ITEM-A", { id: "uuid-item-a" }],
          ["ITEM-B", { id: "uuid-item-b" }],
        ]),
      );

      await dataMapper.processEntityWithEvents(
        "configs/test/orders/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          input: {
            orderNumber: "ORD-001",
            lines: [
              { sku: "ITEM-A", itemId: "uuid-item-a" },
              { sku: "ITEM-B", itemId: "uuid-item-b" },
            ],
          },
        },
        undefined,
        undefined,
      );
    });

    it("should return original data unchanged when no $ref objects exist in data values", async () => {
      const mockConfig = {
        name: "products",
        dataFile: "data.json",
        dataFormat: "json",
        graphqlFile: "mutation.graphql",
        mapping: {
          input: "$",
        },
      };

      const mockData = [{ name: "Widget", price: 9.99, tags: ["sale", "new"] }];

      const mockMutation =
        "mutation CreateProduct($input: ProductInput!) { createProduct(input: $input) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockData);

      executeMutation.mockResolvedValue({ createProduct: { id: "prod-1" } });

      const outputStore: OutputStore = new Map();

      await dataMapper.processEntityWithEvents(
        "configs/test/products/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      // Data should pass through unchanged — no $ref to resolve
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        { input: { name: "Widget", price: 9.99, tags: ["sale", "new"] } },
        undefined,
        undefined,
      );
    });

    it("should warn and use undefined for failed data-level $ref lookups", async () => {
      const mockConfig = {
        name: "orders",
        dataFile: "data.json",
        dataFormat: "json",
        graphqlFile: "mutation.graphql",
        mapping: {
          input: "$",
        },
      };

      const mockData = [
        {
          orderNumber: "ORD-001",
          lines: [{ sku: "MISSING", itemId: { $ref: "items", key: "MISSING", field: "id" } }],
        },
      ];

      const mockMutation =
        "mutation CreateOrder($input: OrderInput!) { createOrder(input: $input) { id } }";

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockConfig))
        .mockReturnValueOnce(mockMutation);

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockData);

      executeMutation.mockResolvedValue({ createOrder: { id: "order-1" } });

      const outputStore: OutputStore = new Map();
      outputStore.set("items", new Map([["ITEM-A", { id: "uuid-item-a" }]]));

      await dataMapper.processEntityWithEvents(
        "configs/test/orders/entity.json",
        undefined,
        undefined,
        undefined,
        undefined,
        outputStore,
      );

      // Data-level $ref failure is a soft warning, not a row-level error
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('$ref key "MISSING" not found'),
      );

      // Mutation still called with undefined for the unresolved ref
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          input: {
            orderNumber: "ORD-001",
            lines: [{ sku: "MISSING", itemId: undefined }],
          },
        },
        undefined,
        undefined,
      );
    });

    it("should convert numeric types from CSV strings to proper GraphQL types", async () => {
      const mockConfig = {
        name: "products",
        dataFile: "products.csv",
        graphqlFile: "products.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/products/entity.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          price: 19.99,
          quantity: 10,
          active: true,
        },
        undefined,
        undefined,
      );
    });

    it("should handle invalid numeric conversions gracefully", async () => {
      const mockConfig = {
        name: "products",
        dataFile: "products.csv",
        graphqlFile: "products.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/products/entity.json");

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          price: "invalid_price",
          quantity: "invalid_quantity",
        },
        undefined,
        undefined,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Warning: Cannot convert "invalid_price" to Float for variable $price. Expected a valid number. Using original value.',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Warning: Cannot convert "invalid_quantity" to Int for variable $quantity. Expected a valid integer. Using original value.',
      );
    });

    it("should handle edge cases in numeric conversion safely", async () => {
      const mockConfig = {
        name: "products",
        dataFile: "products.csv",
        graphqlFile: "products.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      await dataMapper.processEntity("configs/test/products/entity.json");

      // Should keep invalid values as strings
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          int_field: "1.5",
          float_field: "Infinity",
        },
        undefined,
        undefined,
      );

      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          int_field: "not_a_number",
          float_field: "1.2.3",
        },
        undefined,
        undefined,
      );
    });

    it("should keep unknown scalar types as strings", async () => {
      const mockConfig = {
        name: "products",
        dataFile: "products.csv",
        graphqlFile: "products.graphql",
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

      const { DataReaderFactory } = require("../readers");
      DataReaderFactory.getReader().readFile.mockResolvedValue(mockCsvData);

      executeMutation.mockResolvedValue({
        createProduct: { id: "123" },
      });

      const verboseMapper = new DataMapper(mockClient, testBasePath, mockMetrics, mockLogger);

      await verboseMapper.processEntity("configs/test/products/entity.json");

      // Should keep custom scalar as string
      expect(executeMutation).toHaveBeenCalledWith(
        mockMutation,
        {
          name: "Widget",
          custom_field: "123",
        },
        undefined,
        undefined,
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Unknown GraphQL type "CustomScalar" for variable $custom_field. Keeping value as string.',
      );
    });
  });
});
