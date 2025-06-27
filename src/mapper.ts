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

  constructor(
    client: GraphQLClientWrapper,
    basePath: string = process.cwd(),
    metrics?: MetricsCollector
  ) {
    this.client = client;
    this.basePath = basePath;
    this.metrics = metrics || new MetricsCollector();
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
    for (const row of csvData) {
      const variables = this.mapCsvRowToVariables(row, mapping);

      try {
        const result = await this.client.executeMutation(mutation, variables);
        this.metrics.recordSuccess(entityName);
        console.log(`✓ Created entity with result:`, result);
      } catch (error) {
        this.metrics.recordFailure(entityName);
        console.error(`✗ Failed to create entity for row:`, row, error);
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

    for (const chunk of chunks) {
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

      // Log results
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          const { success, result: mutationResult, error, row } = result.value;
          if (success) {
            console.log(`✓ Created entity with result:`, mutationResult);
          } else {
            console.error(`✗ Failed to create entity for row:`, row, error);
          }
        } else {
          console.error(`✗ Promise rejected:`, result.reason);
        }
      });
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
