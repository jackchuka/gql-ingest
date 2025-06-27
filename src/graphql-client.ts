import { GraphQLClient } from 'graphql-request';
import { MetricsCollector } from './metrics';

export class GraphQLClientWrapper {
  private client: GraphQLClient;
  private metrics?: MetricsCollector;
  private verbose: boolean;

  constructor(endpoint: string, headers?: Record<string, string>, metrics?: MetricsCollector, verbose: boolean = false) {
    this.client = new GraphQLClient(endpoint, {
      headers: headers || {}
    });
    this.metrics = metrics;
    this.verbose = verbose;
  }

  async executeMutation(mutation: string, variables: Record<string, any>): Promise<any> {
    const startTime = Date.now();
    
    try {
      const result = await this.client.request(mutation, variables);
      
      if (this.metrics) {
        const duration = Date.now() - startTime;
        this.metrics.recordRequestDuration(duration);
      }
      
      if (this.verbose) {
        console.log(`✓ GraphQL request completed in ${Date.now() - startTime}ms:`, result);
      }
      
      return result;
    } catch (error) {
      if (this.metrics) {
        const duration = Date.now() - startTime;
        this.metrics.recordRequestDuration(duration);
      }
      
      if (this.verbose) {
        console.error(`✗ GraphQL request failed in ${Date.now() - startTime}ms:`, error);
      } else {
        console.error('GraphQL mutation failed:', error);
      }
      throw error;
    }
  }

  setHeaders(headers: Record<string, string>) {
    this.client.setHeaders(headers);
  }
}