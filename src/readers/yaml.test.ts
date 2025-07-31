import fs from "fs/promises";
import yaml from "js-yaml";
import { YamlReader } from "./yaml";

jest.mock("fs/promises");
jest.mock("js-yaml");

describe("YamlReader", () => {
  let reader: YamlReader;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockYaml = yaml as jest.Mocked<typeof yaml>;

  beforeEach(() => {
    reader = new YamlReader();
    jest.clearAllMocks();
  });

  describe("getSupportedExtensions", () => {
    it("should return yaml and yml as supported extensions", () => {
      expect(reader.getSupportedExtensions()).toEqual(["yaml", "yml"]);
    });
  });

  describe("canHandle", () => {
    it("should return true for .yaml and .yml files", () => {
      expect(reader.canHandle("data.yaml")).toBe(true);
      expect(reader.canHandle("data.yml")).toBe(true);
      expect(reader.canHandle("path/to/file.yaml")).toBe(true);
    });

    it("should return false for non-yaml files", () => {
      expect(reader.canHandle("data.json")).toBe(false);
      expect(reader.canHandle("data.csv")).toBe(false);
      expect(reader.canHandle("data")).toBe(false);
    });
  });

  describe("readFile", () => {
    it("should read and parse YAML array", async () => {
      const mockData = [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ];
      const yamlContent = "- id: 1\n  name: Item 1\n- id: 2\n  name: Item 2";
      mockFs.readFile.mockResolvedValue(yamlContent);
      mockYaml.load.mockReturnValue(mockData);

      const result = await reader.readFile("data.yaml");

      expect(mockFs.readFile).toHaveBeenCalledWith("data.yaml", "utf8");
      expect(mockYaml.load).toHaveBeenCalledWith(yamlContent);
      expect(result).toEqual(mockData);
    });

    it("should wrap single object in array", async () => {
      const mockData = { id: 1, name: "Item 1" };
      const yamlContent = "id: 1\nname: Item 1";
      mockFs.readFile.mockResolvedValue(yamlContent);
      mockYaml.load.mockReturnValue(mockData);

      const result = await reader.readFile("data.yaml");

      expect(result).toEqual([mockData]);
    });

    it("should throw error for invalid YAML", async () => {
      mockFs.readFile.mockResolvedValue("invalid: yaml: content:");
      mockYaml.load.mockImplementation(() => {
        throw new Error("Invalid YAML");
      });

      await expect(reader.readFile("data.yaml")).rejects.toThrow(
        "Invalid YAML"
      );
    });

    it("should throw error for null data", async () => {
      mockFs.readFile.mockResolvedValue("null");
      mockYaml.load.mockReturnValue(null);

      await expect(reader.readFile("data.yaml")).rejects.toThrow(
        "Invalid YAML data structure in file: data.yaml. Expected array or object."
      );
    });

    it("should throw error for primitive values", async () => {
      mockFs.readFile.mockResolvedValue("string value");
      mockYaml.load.mockReturnValue("string value");

      await expect(reader.readFile("data.yaml")).rejects.toThrow(
        "Invalid YAML data structure in file: data.yaml. Expected array or object."
      );
    });
  });
});
