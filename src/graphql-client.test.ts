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
    expect(GraphQLClient).toHaveBeenCalledWith(
      "https://api.example.com/graphql",
      { headers: {} }
    );
  });

  it("should create GraphQLClient with custom headers", () => {
    const headers = { Authorization: "Bearer token123" };
    new GraphQLClientWrapper("https://api.example.com/graphql", headers);

    const { GraphQLClient } = require("graphql-request");
    expect(GraphQLClient).toHaveBeenCalledWith(
      "https://api.example.com/graphql",
      { headers }
    );
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

    await expect(
      clientWrapper.executeMutation(mutation, variables)
    ).rejects.toThrow("GraphQL error");

    expect(consoleSpy).toHaveBeenCalledWith("GraphQL mutation failed:", error);

    consoleSpy.mockRestore();
  });

  it("should set headers on the client", () => {
    const newHeaders = { "X-API-Key": "api123" };

    clientWrapper.setHeaders(newHeaders);

    expect(mockSetHeaders).toHaveBeenCalledWith(newHeaders);
  });
});
