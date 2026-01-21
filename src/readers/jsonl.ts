import fs from "fs/promises";
import { DataReader, DataRow } from "./data-reader";

export class JsonlReader extends DataReader {
  getSupportedExtensions(): string[] {
    return ["jsonl", "ndjson"];
  }

  async readFile(filePath: string): Promise<DataRow[]> {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    const results: DataRow[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const data = JSON.parse(lines[i]);
        results.push(data);
      } catch (error) {
        throw error instanceof Error
          ? new Error(`Invalid JSON at line ${i + 1} in file: ${filePath}: ${error.message}`)
          : error;
      }
    }

    return results;
  }
}
