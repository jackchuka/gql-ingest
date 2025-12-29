import fs from "fs/promises";
import { DataReader, DataRow } from "./data-reader";

export class JsonReader extends DataReader {
  getSupportedExtensions(): string[] {
    return ["json"];
  }

  async readFile(filePath: string): Promise<DataRow[]> {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);

    // If the data is already an array, return it
    if (Array.isArray(data)) {
      return data;
    }

    // If it's a single object, wrap it in an array
    if (typeof data === "object" && data !== null) {
      return [data];
    }

    throw new Error(`Invalid JSON data structure in file: ${filePath}. Expected array or object.`);
  }
}
