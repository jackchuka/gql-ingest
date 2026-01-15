import fs from "fs";
import csv from "csv-parser";
import { DataReader, DataRow } from "./data-reader";

export class CsvReader extends DataReader {
  getSupportedExtensions(): string[] {
    return ["csv"];
  }

  async readFile(filePath: string): Promise<DataRow[]> {
    return new Promise((resolve, reject) => {
      const results: DataRow[] = [];

      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => resolve(results))
        .on("error", (error) => reject(error));
    });
  }
}
