import fs from "fs/promises";
import yaml from "js-yaml";
import { DataReader, DataRow } from "./data-reader";

export class YamlReader extends DataReader {
  getSupportedExtensions(): string[] {
    return ["yaml", "yml"];
  }

  async readFile(filePath: string): Promise<DataRow[]> {
    const content = await fs.readFile(filePath, "utf8");
    const data = yaml.load(content);

    // If the data is already an array, return it
    if (Array.isArray(data)) {
      return data;
    }

    // If it's a single object, wrap it in an array
    if (typeof data === "object" && data !== null) {
      return [data];
    }

    throw new Error(
      `Invalid YAML data structure in file: ${filePath}. Expected array or object.`
    );
  }
}
