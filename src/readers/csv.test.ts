import fs from "fs";
import path from "path";
import { CsvReader } from "./csv";

describe("CsvReader", () => {
  const testDataDir = path.join(__dirname, "test-data");
  const testCsvPath = path.join(testDataDir, "test.csv");
  let reader: CsvReader;

  beforeAll(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    reader = new CsvReader();
  });

  afterAll(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(testCsvPath)) {
      fs.unlinkSync(testCsvPath);
    }
  });

  it("should return correct supported extensions", () => {
    expect(reader.getSupportedExtensions()).toEqual(["csv"]);
  });

  it("should read a simple CSV file", async () => {
    const csvContent = "name,age\nJohn,30\nJane,25";
    fs.writeFileSync(testCsvPath, csvContent);

    const result = await reader.readFile(testCsvPath);

    expect(result).toEqual([
      { name: "John", age: "30" },
      { name: "Jane", age: "25" },
    ]);
  });

  it("should read CSV with special characters", async () => {
    const csvContent =
      'name,description\n"John Doe","A person with, comma"\n"Jane\'s Data","Quote test"';
    fs.writeFileSync(testCsvPath, csvContent);

    const result = await reader.readFile(testCsvPath);

    expect(result).toEqual([
      { name: "John Doe", description: "A person with, comma" },
      { name: "Jane's Data", description: "Quote test" },
    ]);
  });

  it("should handle empty CSV file", async () => {
    const csvContent = "name,age\n";
    fs.writeFileSync(testCsvPath, csvContent);

    const result = await reader.readFile(testCsvPath);

    expect(result).toEqual([]);
  });

  it("should handle CSV with only headers", async () => {
    const csvContent = "name,age";
    fs.writeFileSync(testCsvPath, csvContent);

    const result = await reader.readFile(testCsvPath);

    expect(result).toEqual([]);
  });

  it("should handle CSV with missing values", async () => {
    const csvContent = "name,age,city\nJohn,30,\nJane,,Boston\n,25,NYC";
    fs.writeFileSync(testCsvPath, csvContent);

    const result = await reader.readFile(testCsvPath);

    expect(result).toEqual([
      { name: "John", age: "30", city: "" },
      { name: "Jane", age: "", city: "Boston" },
      { name: "", age: "25", city: "NYC" },
    ]);
  });
});
