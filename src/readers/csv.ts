import fs from "fs";
import csv from "csv-parser";
import { DataReader, DataRow } from "./data-reader";

export interface CsvRow {
  [key: string]: string;
}

export async function readCsvFile(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const results: CsvRow[] = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (error) => reject(error));
  });
}

export class CsvReader extends DataReader {
  getSupportedExtensions(): string[] {
    return ["csv"];
  }

  async readFile(filePath: string): Promise<DataRow[]> {
    return readCsvFile(filePath);
  }
}
