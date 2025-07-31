import { DataReader, DataReaderFactory } from "./data-reader";

class TestReader extends DataReader {
  getSupportedExtensions(): string[] {
    return ["test", "tst"];
  }

  async readFile(filePath: string): Promise<any[]> {
    return [{ test: true }];
  }
}

describe("DataReader", () => {
  describe("canHandle", () => {
    it("should check if reader can handle file based on extension", () => {
      const reader = new TestReader();

      expect(reader.canHandle("file.test")).toBe(true);
      expect(reader.canHandle("file.tst")).toBe(true);
      expect(reader.canHandle("path/to/file.test")).toBe(true);
      expect(reader.canHandle("file.other")).toBe(false);
      expect(reader.canHandle("file")).toBe(false);
    });
  });
});

describe("DataReaderFactory", () => {
  beforeEach(() => {
    // Clear the readers array before each test
    (DataReaderFactory as any).readers = [];
  });

  describe("registerReader", () => {
    it("should register a reader", () => {
      const reader = new TestReader();
      DataReaderFactory.registerReader(reader);

      expect(DataReaderFactory.getSupportedFormats()).toContain("test");
      expect(DataReaderFactory.getSupportedFormats()).toContain("tst");
    });
  });

  describe("getReader", () => {
    beforeEach(() => {
      const reader = new TestReader();
      DataReaderFactory.registerReader(reader);
    });

    it("should get reader by file extension", () => {
      const reader = DataReaderFactory.getReader("file.test");
      expect(reader).toBeInstanceOf(TestReader);
    });

    it("should get reader by format override", () => {
      const reader = DataReaderFactory.getReader("file.other", "test");
      expect(reader).toBeInstanceOf(TestReader);
    });

    it("should prioritize format override over file extension", () => {
      const reader = DataReaderFactory.getReader("file.unknown", "tst");
      expect(reader).toBeInstanceOf(TestReader);
    });

    it("should throw error when no reader found", () => {
      expect(() => DataReaderFactory.getReader("file.unknown")).toThrow(
        "No reader found for file: file.unknown"
      );
    });

    it("should throw error when format specified but no reader found", () => {
      expect(() => DataReaderFactory.getReader("file.txt", "unknown")).toThrow(
        "No reader found for file: file.txt with format: unknown"
      );
    });
  });

  describe("getSupportedFormats", () => {
    it("should return empty array when no readers registered", () => {
      expect(DataReaderFactory.getSupportedFormats()).toEqual([]);
    });

    it("should return all supported formats", () => {
      const reader1 = new TestReader();
      DataReaderFactory.registerReader(reader1);

      const formats = DataReaderFactory.getSupportedFormats();
      expect(formats).toContain("test");
      expect(formats).toContain("tst");
      expect(formats.length).toBe(2);
    });

    it("should not duplicate formats", () => {
      const reader1 = new TestReader();
      const reader2 = new TestReader();
      DataReaderFactory.registerReader(reader1);
      DataReaderFactory.registerReader(reader2);

      const formats = DataReaderFactory.getSupportedFormats();
      expect(formats).toContain("test");
      expect(formats).toContain("tst");
      expect(formats.length).toBe(2);
    });
  });
});
