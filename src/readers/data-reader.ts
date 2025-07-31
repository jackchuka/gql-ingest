export interface DataRow {
  [key: string]: any;
}

export abstract class DataReader {
  abstract readFile(filePath: string): Promise<DataRow[]>;

  /**
   * Get the supported file extensions for this reader
   */
  abstract getSupportedExtensions(): string[];

  /**
   * Check if this reader can handle the given file
   */
  canHandle(filePath: string): boolean {
    const extension = filePath.split(".").pop()?.toLowerCase();
    return extension
      ? this.getSupportedExtensions().includes(extension)
      : false;
  }
}

export class DataReaderFactory {
  private static readers: DataReader[] = [];

  static registerReader(reader: DataReader): void {
    this.readers.push(reader);
  }

  static getReader(filePath: string, format?: string): DataReader {
    // If format is specified, try to find reader by format
    if (format) {
      const reader = this.readers.find((r) =>
        r.getSupportedExtensions().includes(format.toLowerCase())
      );
      if (reader) return reader;
    }

    // Otherwise, try to find reader by file extension
    const reader = this.readers.find((r) => r.canHandle(filePath));

    if (!reader) {
      throw new Error(
        `No reader found for file: ${filePath}${
          format ? ` with format: ${format}` : ""
        }`
      );
    }

    return reader;
  }

  static getSupportedFormats(): string[] {
    const formats = new Set<string>();
    this.readers.forEach((reader) => {
      reader.getSupportedExtensions().forEach((ext) => formats.add(ext));
    });
    return Array.from(formats);
  }
}
