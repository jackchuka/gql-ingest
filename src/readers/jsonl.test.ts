import fs from "fs/promises";
import { JsonlReader } from "./jsonl";

jest.mock("fs/promises");

describe("JsonlReader", () => {
  let reader: JsonlReader;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    reader = new JsonlReader();
    jest.clearAllMocks();
  });

  describe("getSupportedExtensions", () => {
    it("should return jsonl and ndjson as supported extensions", () => {
      expect(reader.getSupportedExtensions()).toEqual(["jsonl", "ndjson"]);
    });
  });

  describe("canHandle", () => {
    it("should return true for .jsonl and .ndjson files", () => {
      expect(reader.canHandle("data.jsonl")).toBe(true);
      expect(reader.canHandle("data.ndjson")).toBe(true);
      expect(reader.canHandle("path/to/file.jsonl")).toBe(true);
    });

    it("should return false for non-jsonl files", () => {
      expect(reader.canHandle("data.json")).toBe(false);
      expect(reader.canHandle("data.csv")).toBe(false);
      expect(reader.canHandle("data")).toBe(false);
    });
  });

  describe("readFile", () => {
    it("should read and parse JSONL file", async () => {
      const line1 = { id: 1, name: "Item 1" };
      const line2 = { id: 2, name: "Item 2" };
      const jsonlContent = `${JSON.stringify(line1)}\n${JSON.stringify(line2)}`;
      mockFs.readFile.mockResolvedValue(jsonlContent);

      const result = await reader.readFile("data.jsonl");

      expect(mockFs.readFile).toHaveBeenCalledWith("data.jsonl", "utf8");
      expect(result).toEqual([line1, line2]);
    });

    it("should handle empty lines", async () => {
      const line1 = { id: 1, name: "Item 1" };
      const line2 = { id: 2, name: "Item 2" };
      const jsonlContent = `${JSON.stringify(line1)}\n\n${JSON.stringify(
        line2
      )}\n`;
      mockFs.readFile.mockResolvedValue(jsonlContent);

      const result = await reader.readFile("data.jsonl");

      expect(result).toEqual([line1, line2]);
    });

    it("should handle single line", async () => {
      const line = { id: 1, name: "Item 1" };
      mockFs.readFile.mockResolvedValue(JSON.stringify(line));

      const result = await reader.readFile("data.jsonl");

      expect(result).toEqual([line]);
    });

    it("should throw error for invalid JSON on specific line", async () => {
      const line1 = { id: 1, name: "Item 1" };
      const jsonlContent = `${JSON.stringify(line1)}\ninvalid json\n`;
      mockFs.readFile.mockResolvedValue(jsonlContent);

      await expect(reader.readFile("data.jsonl")).rejects.toThrow(
        "Invalid JSON at line 2 in file: data.jsonl"
      );
    });

    it("should handle empty file", async () => {
      mockFs.readFile.mockResolvedValue("");

      const result = await reader.readFile("data.jsonl");

      expect(result).toEqual([]);
    });

    it("should handle file with only whitespace", async () => {
      mockFs.readFile.mockResolvedValue("\n\n  \n\t\n");

      const result = await reader.readFile("data.jsonl");

      expect(result).toEqual([]);
    });
  });
});
