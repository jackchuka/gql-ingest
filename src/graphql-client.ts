import { GraphQLClient } from 'graphql-request';
import { MetricsCollector } from './metrics';

export class GraphQLClientWrapper {
  private client: GraphQLClient;
  private metrics?: MetricsCollector;

  constructor(endpoint: string, headers?: Record<string, string>, metrics?: MetricsCollector) {
    this.client = new GraphQLClient(endpoint, {
      headers: headers || {}
    });
    this.metrics = metrics;
  }

  async executeMutation(mutation: string, variables: Record<string, any>): Promise<any> {
    const startTime = Date.now();
    
    try {
      const result = await this.client.request(mutation, variables);
      
      if (this.metrics) {
        const duration = Date.now() - startTime;
        console.debug(`GraphQL request completed in ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      if (this.metrics) {
        const duration = Date.now() - startTime;
        console.debug(`GraphQL request failed in ${duration}ms`);
      }
      
      console.error('GraphQL mutation failed:', error);
      throw error;
    }
  }

  setHeaders(headers: Record<string, string>) {
    this.client.setHeaders(headers);
  }
}