import fs from "fs";
import path from "path";
import { readCsvFile, CsvRow } from "./csv-reader";
import { GraphQLClientWrapper } from "./graphql-client";
import { MetricsCollector } from "./metrics";
import { ParallelProcessingConfig } from "./config";

export interface MappingConfig {
  csvFile: string;
  graphqlFile: string;
  mapping: Record<string, string>;
}

export class DataMapper {
  private client: GraphQLClientWrapper;
  private basePath: string;
  private metrics: MetricsCollector;
  private verbose: boolean;

  constructor(
    client: GraphQLClientWrapper,
    basePath: string = process.cwd(),
    metrics?: MetricsCollector,
    verbose: boolean = false
  ) {
    this.client = client;
    this.basePath = basePath;
    this.metrics = metrics || new MetricsCollector();
    this.verbose = verbose;
  }

  discoverMappings(configDir: string): string[] {
    const mappingsPath = path.resolve(this.basePath, configDir, "mappings");

    try {
      const files = fs.readdirSync(mappingsPath);
      const jsonFiles = files.filter((file) => file.endsWith(".json")).sort(); // Alphabetical order for consistent processing

      console.log(
        `Discovered ${jsonFiles.length} mapping files: ${jsonFiles.join(", ")}`
      );
      return jsonFiles.map((file) => path.join(configDir, "mappings", file));
    } catch (error) {
      console.error(`Error reading mappings directory ${mappingsPath}:`, error);
      return [];
    }
  }

  async processEntity(
    configPath: string,
    parallelConfig?: ParallelProcessingConfig
  ): Promise<void> {
    const entityName = path.basename(configPath, ".json");
    console.log(`Processing entity: ${configPath}`);

    this.metrics.startEntityProcessing(entityName);

    // Read mapping configuration
    const configFullPath = path.resolve(this.basePath, configPath);
    const config: MappingConfig = JSON.parse(
      fs.readFileSync(configFullPath, "utf8")
    );

    // Extract config directory (parent of mappings directory)
    const configDir = path.dirname(path.dirname(configFullPath));

    // Read CSV data (relative to config directory)
    const csvPath = path.resolve(configDir, config.csvFile);
    const csvData = await readCsvFile(csvPath);

    // Read GraphQL mutation (relative to config directory)
    const graphqlPath = path.resolve(configDir, config.graphqlFile);
    const mutation = fs.readFileSync(graphqlPath, "utf8");

    // Process rows with optional parallelization
    if (parallelConfig && parallelConfig.concurrency > 1) {
      await this.processRowsConcurrently(
        csvData,
        mutation,
        config.mapping,
        entityName,
        parallelConfig
      );
    } else {
      await this.processRowsSequentially(
        csvData,
        mutation,
        config.mapping,
        entityName
      );
    }

    this.metrics.finishEntityProcessing(entityName);
  }

  private async processRowsSequentially(
    csvData: CsvRow[],
    mutation: string,
    mapping: Record<string, string>,
    entityName: string
  ): Promise<void> {
    const totalRows = csvData.length;
    
    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      const variables = this.mapCsvRowToVariables(row, mapping);

      try {
        await this.client.executeMutation(mutation, variables);
        this.metrics.recordSuccess(entityName);
        
        // Show progress every 10% or at the end (only in non-verbose mode)
        if (!this.verbose && ((i + 1) % Math.max(1, Math.floor(totalRows / 10)) === 0 || i === totalRows - 1)) {
          const progress = (((i + 1) / totalRows) * 100).toFixed(1);
          console.log(`📊 Progress: ${i + 1}/${totalRows} (${progress}%) ✓`);
        }
      } catch (error) {
        this.metrics.recordFailure(entityName);
        if (!this.verbose) {
          console.error(`✗ Failed to create entity for row ${i + 1}:`, row, error);
        }
      }
    }
  }

  private async processRowsConcurrently(
    csvData: CsvRow[],
    mutation: string,
    mapping: Record<string, string>,
    entityName: string,
    parallelConfig: ParallelProcessingConfig
  ): Promise<void> {
    const concurrency = parallelConfig.concurrency;
    console.log(
      `Processing ${csvData.length} rows with concurrency: ${concurrency}`
    );

    // Split data into chunks for concurrent processing
    const chunks = this.chunkArray(csvData, concurrency);
    let processedCount = 0;
    const totalRows = csvData.length;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const promises = chunk.map(async (row) => {
        const variables = this.mapCsvRowToVariables(row, mapping);

        try {
          const result = await this.client.executeMutation(mutation, variables);
          this.metrics.recordSuccess(entityName);
          return { success: true, result, row };
        } catch (error) {
          this.metrics.recordFailure(entityName);
          return { success: false, error, row };
        }
      });

      const results = await Promise.allSettled(promises);
      processedCount += chunk.length;

      // Count successes and failures in this chunk
      let chunkSuccesses = 0;
      let chunkFailures = 0;
      
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          const { success, error, row } = result.value;
          if (success) {
            chunkSuccesses++;
          } else {
            chunkFailures++;
            if (!this.verbose) {
              console.error(`✗ Failed to create entity for row:`, row, error);
            }
          }
        } else {
          chunkFailures++;
          if (!this.verbose) {
            console.error(`✗ Promise rejected:`, result.reason);
          }
        }
      });

      // Show progress update (only in non-verbose mode)
      if (!this.verbose) {
        const progress = ((processedCount / totalRows) * 100).toFixed(1);
        console.log(`📊 Progress: ${processedCount}/${totalRows} (${progress}%) - Chunk ${chunkIndex + 1}: ${chunkSuccesses} ✓, ${chunkFailures} ✗`);
      }
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private mapCsvRowToVariables(
    row: CsvRow,
    mapping: Record<string, string>
  ): Record<string, any> {
    const variables: Record<string, any> = {};

    for (const [graphqlVar, csvColumn] of Object.entries(mapping)) {
      if (row[csvColumn] !== undefined) {
        variables[graphqlVar] = row[csvColumn];
      }
    }

    return variables;
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }
}
