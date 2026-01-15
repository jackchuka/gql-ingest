import { GraphQLClient } from "graphql-request";
import { MetricsCollector } from "./metrics";
import { DEFAULT_RETRY_CONFIG, RetryConfig } from "./config";
import { Logger, noopLogger } from "./logger";

export class GraphQLClientWrapper {
  private client: GraphQLClient;
  private metrics?: MetricsCollector;
  private logger: Logger;

  constructor(
    endpoint: string,
    headers?: Record<string, string>,
    metrics?: MetricsCollector,
    logger: Logger = noopLogger,
  ) {
    this.client = new GraphQLClient(endpoint, {
      headers: headers || {},
    });
    this.metrics = metrics;
    this.logger = logger;
  }

  async executeMutation(
    mutation: string,
    variables: Record<string, any>,
    retryConfig?: RetryConfig,
  ): Promise<any> {
    const config = retryConfig || DEFAULT_RETRY_CONFIG;

    let lastError: any;
    const totalStartTime = Date.now();

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      const attemptStartTime = Date.now();

      try {
        const result = await this.client.request(mutation, variables);

        if (this.metrics) {
          const duration = Date.now() - attemptStartTime;
          this.metrics.recordRequestDuration(duration);
          if (attempt > 0) {
            this.metrics.recordRetrySuccess(attempt);
          }
        }

        const totalDuration = Date.now() - totalStartTime;
        const retryInfo = attempt > 0 ? ` (succeeded on attempt ${attempt + 1})` : "";
        this.logger.debug(`✓ GraphQL request completed in ${totalDuration}ms${retryInfo}`, result);

        return result;
      } catch (error: any) {
        lastError = error;
        const duration = Date.now() - attemptStartTime;

        if (this.metrics) {
          this.metrics.recordRequestDuration(duration);
        }

        // Check if this is the last attempt
        if (attempt === config.maxAttempts - 1) {
          if (this.metrics && attempt > 0) {
            this.metrics.recordRetryFailure(attempt);
          }
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error, config)) {
          this.logger.error(
            `✗ GraphQL request failed with non-retryable error in ${duration}ms`,
            error,
          );
          throw error;
        }

        // Calculate delay
        const delay = this.calculateDelay(attempt, config);
        this.logger.debug(
          `⏳ GraphQL request failed (attempt ${attempt + 1}/${config.maxAttempts}), retrying in ${delay}ms...`,
        );

        // Wait before retry
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    const totalDuration = Date.now() - totalStartTime;
    this.logger.error(
      `✗ GraphQL request failed after ${config.maxAttempts} attempts in ${totalDuration}ms`,
      lastError,
    );

    throw lastError;
  }

  private isRetryableError(error: any, config: RetryConfig): boolean {
    // Network errors (no response)
    if (!error.response) {
      return true;
    }

    // Check HTTP status codes
    const status = error.response.status;
    return config.retryableStatusCodes.includes(status);
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    if (!config.exponentialBackoff) {
      return config.baseDelay;
    }

    const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelay);

    // Add jitter (±20% randomization)
    const jitter = cappedDelay * 0.2 * (Math.random() - 0.5);
    return Math.max(0, cappedDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  setHeaders(headers: Record<string, string>) {
    this.client.setHeaders(headers);
  }
}
