import fs from "fs/promises";
import { JsonReader } from "./json";

jest.mock("fs/promises");

describe("JsonReader", () => {
  let reader: JsonReader;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    reader = new JsonReader();
    jest.clearAllMocks();
  });

  describe("getSupportedExtensions", () => {
    it("should return json as supported extension", () => {
      expect(reader.getSupportedExtensions()).toEqual(["json"]);
    });
  });

  describe("canHandle", () => {
    it("should return true for .json files", () => {
      expect(reader.canHandle("data.json")).toBe(true);
      expect(reader.canHandle("path/to/file.json")).toBe(true);
      expect(reader.canHandle("file.JSON")).toBe(true); // case insensitive
    });

    it("should return false for non-json files", () => {
      expect(reader.canHandle("data.csv")).toBe(false);
      expect(reader.canHandle("data.yaml")).toBe(false);
      expect(reader.canHandle("data")).toBe(false);
    });
  });

  describe("readFile", () => {
    it("should read and parse JSON array", async () => {
      const mockData = [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ];
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockData));

      const result = await reader.readFile("data.json");

      expect(mockFs.readFile).toHaveBeenCalledWith("data.json", "utf8");
      expect(result).toEqual(mockData);
    });

    it("should wrap single object in array", async () => {
      const mockData = { id: 1, name: "Item 1" };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockData));

      const result = await reader.readFile("data.json");

      expect(result).toEqual([mockData]);
    });

    it("should throw error for invalid JSON", async () => {
      mockFs.readFile.mockResolvedValue("invalid json");

      await expect(reader.readFile("data.json")).rejects.toThrow();
    });

    it("should throw error for null data", async () => {
      mockFs.readFile.mockResolvedValue("null");

      await expect(reader.readFile("data.json")).rejects.toThrow(
        "Invalid JSON data structure in file: data.json. Expected array or object."
      );
    });

    it("should throw error for primitive values", async () => {
      mockFs.readFile.mockResolvedValue('"string value"');

      await expect(reader.readFile("data.json")).rejects.toThrow(
        "Invalid JSON data structure in file: data.json. Expected array or object."
      );
    });
  });
});
