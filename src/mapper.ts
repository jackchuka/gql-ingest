import fs from 'fs';
import path from 'path';
import { readCsvFile, CsvRow } from './csv-reader';
import { GraphQLClientWrapper } from './graphql-client';

export interface MappingConfig {
  csvFile: string;
  graphqlFile: string;
  mapping: Record<string, string>;
}

export class DataMapper {
  private client: GraphQLClientWrapper;
  private basePath: string;

  constructor(client: GraphQLClientWrapper, basePath: string = process.cwd()) {
    this.client = client;
    this.basePath = basePath;
  }

  discoverMappings(configDir: string): string[] {
    const mappingsPath = path.resolve(this.basePath, configDir, 'mappings');
    
    try {
      const files = fs.readdirSync(mappingsPath);
      const jsonFiles = files
        .filter(file => file.endsWith('.json'))
        .sort(); // Alphabetical order for consistent processing
      
      console.log(`Discovered ${jsonFiles.length} mapping files: ${jsonFiles.join(', ')}`);
      return jsonFiles.map(file => path.join(configDir, 'mappings', file));
    } catch (error) {
      console.error(`Error reading mappings directory ${mappingsPath}:`, error);
      return [];
    }
  }

  async processEntity(configPath: string): Promise<void> {
    console.log(`Processing entity: ${configPath}`);
    
    // Read mapping configuration
    const configFullPath = path.resolve(this.basePath, configPath);
    const config: MappingConfig = JSON.parse(fs.readFileSync(configFullPath, 'utf8'));
    
    // Extract config directory (parent of mappings directory)
    const configDir = path.dirname(path.dirname(configFullPath));
    
    // Read CSV data (relative to config directory)
    const csvPath = path.resolve(configDir, config.csvFile);
    const csvData = await readCsvFile(csvPath);
    
    // Read GraphQL mutation (relative to config directory)
    const graphqlPath = path.resolve(configDir, config.graphqlFile);
    const mutation = fs.readFileSync(graphqlPath, 'utf8');
    
    // Process each row
    for (const row of csvData) {
      const variables = this.mapCsvRowToVariables(row, config.mapping);
      
      try {
        const result = await this.client.executeMutation(mutation, variables);
        console.log(`✓ Created entity with result:`, result);
      } catch (error) {
        console.error(`✗ Failed to create entity for row:`, row, error);
      }
    }
  }

  private mapCsvRowToVariables(row: CsvRow, mapping: Record<string, string>): Record<string, any> {
    const variables: Record<string, any> = {};
    
    for (const [graphqlVar, csvColumn] of Object.entries(mapping)) {
      if (row[csvColumn] !== undefined) {
        variables[graphqlVar] = row[csvColumn];
      }
    }
    
    return variables;
  }
}