import { GraphQLClient } from 'graphql-request';

export class GraphQLClientWrapper {
  private client: GraphQLClient;

  constructor(endpoint: string, headers?: Record<string, string>) {
    this.client = new GraphQLClient(endpoint, {
      headers: headers || {}
    });
  }

  async executeMutation(mutation: string, variables: Record<string, any>): Promise<any> {
    try {
      const result = await this.client.request(mutation, variables);
      return result;
    } catch (error) {
      console.error('GraphQL mutation failed:', error);
      throw error;
    }
  }

  setHeaders(headers: Record<string, string>) {
    this.client.setHeaders(headers);
  }
}