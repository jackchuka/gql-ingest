import { GraphQLClientWrapper } from "./graphql-client";

const mockRequest = jest.fn();
const mockSetHeaders = jest.fn();

jest.mock("graphql-request", () => ({
  GraphQLClient: jest.fn().mockImplementation(() => ({
    request: mockRequest,
    setHeaders: mockSetHeaders,
  })),
}));

describe("GraphQLClientWrapper", () => {
  let clientWrapper: GraphQLClientWrapper;

  beforeEach(() => {
    jest.clearAllMocks();
    clientWrapper = new GraphQLClientWrapper("https://api.example.com/graphql");
  });

  it("should create GraphQLClient with endpoint and default headers", () => {
    const { GraphQLClient } = require("graphql-request");
    expect(GraphQLClient).toHaveBeenCalledWith("https://api.example.com/graphql", { headers: {} });
  });

  it("should create GraphQLClient with custom headers", () => {
    const headers = { Authorization: "Bearer token123" };
    new GraphQLClientWrapper("https://api.example.com/graphql", headers);

    const { GraphQLClient } = require("graphql-request");
    expect(GraphQLClient).toHaveBeenCalledWith("https://api.example.com/graphql", { headers });
  });

  it("should execute mutation successfully", async () => {
    const mutation = "mutation { createUser(name: $name) { id } }";
    const variables = { name: "John" };
    const expectedResult = { createUser: { id: "123" } };

    mockRequest.mockResolvedValue(expectedResult);

    const result = await clientWrapper.executeMutation(mutation, variables);

    expect(mockRequest).toHaveBeenCalledWith(mutation, variables);
    expect(result).toEqual(expectedResult);
  });

  it("should handle GraphQL errors", async () => {
    const mutation = "mutation { createUser(name: $name) { id } }";
    const variables = { name: "John" };
    const error = new Error("GraphQL error");

    mockRequest.mockRejectedValue(error);

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    await expect(clientWrapper.executeMutation(mutation, variables)).rejects.toThrow(
      "GraphQL error",
    );

    expect(consoleSpy).toHaveBeenCalledWith("GraphQL mutation failed after 3 attempts:", error);

    consoleSpy.mockRestore();
  });

  it("should set headers on the client", () => {
    const newHeaders = { "X-API-Key": "api123" };

    clientWrapper.setHeaders(newHeaders);

    expect(mockSetHeaders).toHaveBeenCalledWith(newHeaders);
  });

  describe("retry functionality", () => {
    it("should retry on retryable status codes", async () => {
      const mutation = "mutation { createUser(name: $name) { id } }";
      const variables = { name: "John" };
      const retryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 1000,
        exponentialBackoff: false,
        retryableStatusCodes: [500],
      };

      const serverError = new Error("Server Error");
      (serverError as any).response = { status: 500 };

      mockRequest
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { result: "success" } });

      const result = await clientWrapper.executeMutation(mutation, variables, retryConfig);

      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ data: { result: "success" } });
    });

    it("should not retry on non-retryable status codes", async () => {
      const mutation = "mutation { createUser(name: $name) { id } }";
      const variables = { name: "John" };
      const retryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 1000,
        exponentialBackoff: false,
        retryableStatusCodes: [500],
      };

      const clientError = new Error("Bad Request");
      (clientError as any).response = { status: 400 };

      mockRequest.mockRejectedValueOnce(clientError);

      await expect(clientWrapper.executeMutation(mutation, variables, retryConfig)).rejects.toThrow(
        "Bad Request",
      );

      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("should retry on network errors (no response)", async () => {
      const mutation = "mutation { createUser(name: $name) { id } }";
      const variables = { name: "John" };
      const retryConfig = {
        maxAttempts: 2,
        baseDelay: 100,
        maxDelay: 1000,
        exponentialBackoff: false,
        retryableStatusCodes: [500],
      };

      const networkError = new Error("Network Error");
      // No response property = network error

      mockRequest
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ data: { result: "success" } });

      const result = await clientWrapper.executeMutation(mutation, variables, retryConfig);

      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: { result: "success" } });
    });

    it("should fail after max attempts are exhausted", async () => {
      const mutation = "mutation { createUser(name: $name) { id } }";
      const variables = { name: "John" };
      const retryConfig = {
        maxAttempts: 2,
        baseDelay: 100,
        maxDelay: 1000,
        exponentialBackoff: false,
        retryableStatusCodes: [500],
      };

      const serverError = new Error("Server Error");
      (serverError as any).response = { status: 500 };

      mockRequest.mockRejectedValue(serverError);

      await expect(clientWrapper.executeMutation(mutation, variables, retryConfig)).rejects.toThrow(
        "Server Error",
      );

      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("should use exponential backoff when configured", async () => {
      const mutation = "mutation { createUser(name: $name) { id } }";
      const variables = { name: "John" };
      const retryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 1000,
        exponentialBackoff: true,
        retryableStatusCodes: [500],
      };

      const serverError = new Error("Server Error");
      (serverError as any).response = { status: 500 };

      mockRequest
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { result: "success" } });

      const startTime = Date.now();
      const result = await clientWrapper.executeMutation(mutation, variables, retryConfig);
      const totalTime = Date.now() - startTime;

      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ data: { result: "success" } });
      // Should have some delay for retries (base + exponential)
      expect(totalTime).toBeGreaterThan(200); // At least 100ms base + 200ms exponential
    });
  });
});
