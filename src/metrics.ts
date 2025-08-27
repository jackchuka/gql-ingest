export interface EntityMetrics {
  rowsProcessed: number;
  successfulRows: number;
  failedRows: number;
  duration: number;
}

export interface ProcessingMetrics {
  totalRows: number;
  successfulOperations: number;
  failedOperations: number;
  totalDuration: number;
  entities: Record<string, EntityMetrics>;
}

export interface InternalMetrics {
  totalEntities: number;
  totalSuccesses: number;
  totalFailures: number;
  entityMetrics: Map<string, InternalEntityMetrics>;
  requestDurations: number[];
  retryAttempts: number;
  retrySuccesses: number;
  retryFailures: number;
  startTime: number;
  endTime?: number;
}

export interface InternalEntityMetrics {
  entityName: string;
  successCount: number;
  failureCount: number;
  startTime: number;
  endTime?: number;
}

export class MetricsCollector {
  private metrics: InternalMetrics;

  constructor() {
    this.metrics = {
      totalEntities: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      entityMetrics: new Map(),
      requestDurations: [],
      retryAttempts: 0,
      retrySuccesses: 0,
      retryFailures: 0,
      startTime: Date.now(),
    };
  }

  startEntityProcessing(entityName: string): void {
    if (!this.metrics.entityMetrics.has(entityName)) {
      this.metrics.entityMetrics.set(entityName, {
        entityName,
        successCount: 0,
        failureCount: 0,
        startTime: Date.now(),
      });
    }
  }

  recordSuccess(entityName: string): void {
    const entityMetric = this.metrics.entityMetrics.get(entityName);
    if (entityMetric) {
      entityMetric.successCount++;
      this.metrics.totalSuccesses++;
      this.metrics.totalEntities++;
    }
  }

  recordFailure(entityName: string): void {
    const entityMetric = this.metrics.entityMetrics.get(entityName);
    if (entityMetric) {
      entityMetric.failureCount++;
      this.metrics.totalFailures++;
      this.metrics.totalEntities++;
    }
  }

  finishEntityProcessing(entityName: string): void {
    const entityMetric = this.metrics.entityMetrics.get(entityName);
    if (entityMetric) {
      entityMetric.endTime = Date.now();
    }
  }

  finishProcessing(): InternalMetrics {
    this.metrics.endTime = Date.now();
    return { ...this.metrics };
  }

  getEntityMetrics(entityName: string): InternalEntityMetrics | undefined {
    return this.metrics.entityMetrics.get(entityName);
  }

  getMetrics(): ProcessingMetrics {
    const endTime = this.metrics.endTime || Date.now();
    const totalDuration = endTime - this.metrics.startTime;

    const entities: Record<string, EntityMetrics> = {};
    for (const [name, metrics] of this.metrics.entityMetrics) {
      const entityEndTime = metrics.endTime || Date.now();
      entities[name] = {
        rowsProcessed: metrics.successCount + metrics.failureCount,
        successfulRows: metrics.successCount,
        failedRows: metrics.failureCount,
        duration: entityEndTime - metrics.startTime,
      };
    }

    return {
      totalRows: this.metrics.totalEntities,
      successfulOperations: this.metrics.totalSuccesses,
      failedOperations: this.metrics.totalFailures,
      totalDuration,
      entities,
    };
  }

  getTotalProcessed(): number {
    return this.metrics.totalEntities;
  }

  getSuccessRate(): number {
    if (this.metrics.totalEntities === 0) return 0;
    return (this.metrics.totalSuccesses / this.metrics.totalEntities) * 100;
  }

  recordRequestDuration(duration: number): void {
    this.metrics.requestDurations.push(duration);
  }

  recordRetrySuccess(attempts: number): void {
    this.metrics.retryAttempts += attempts;
    this.metrics.retrySuccesses++;
  }

  recordRetryFailure(attempts: number): void {
    this.metrics.retryAttempts += attempts;
    this.metrics.retryFailures++;
  }

  getAverageRequestDuration(): number {
    if (this.metrics.requestDurations.length === 0) return 0;
    const sum = this.metrics.requestDurations.reduce((a, b) => a + b, 0);
    return sum / this.metrics.requestDurations.length;
  }

  getDurationMs(): number {
    const endTime = this.metrics.endTime || Date.now();
    return endTime - this.metrics.startTime;
  }

  generateSummary(): string {
    const duration = this.getDurationMs();
    const successRate = this.getSuccessRate();
    const avgRequestDuration = this.getAverageRequestDuration();

    let summary = `\n📊 Processing Summary:\n`;
    summary += `   Total Processed: ${this.metrics.totalEntities}\n`;
    summary += `   ✓ Successes: ${this.metrics.totalSuccesses}\n`;
    summary += `   ✗ Failures: ${this.metrics.totalFailures}\n`;
    summary += `   Success Rate: ${successRate.toFixed(1)}%\n`;
    summary += `   Duration: ${(duration / 1000).toFixed(2)}s\n`;

    if (this.metrics.requestDurations.length > 0) {
      summary += `   Avg Request Time: ${avgRequestDuration.toFixed(0)}ms\n`;
    }

    if (this.metrics.retryAttempts > 0) {
      summary += `   Retry Attempts: ${this.metrics.retryAttempts}\n`;
      summary += `   Retry Successes: ${this.metrics.retrySuccesses}\n`;
      summary += `   Retry Failures: ${this.metrics.retryFailures}\n`;
    }

    if (this.metrics.entityMetrics.size > 0) {
      summary += `\n📋 Per-Entity Breakdown:\n`;
      for (const [entityName, entityMetric] of this.metrics.entityMetrics) {
        const entityTotal =
          entityMetric.successCount + entityMetric.failureCount;
        const entityRate =
          entityTotal > 0 ? (entityMetric.successCount / entityTotal) * 100 : 0;
        const entityDuration = entityMetric.endTime
          ? entityMetric.endTime - entityMetric.startTime
          : 0;

        summary += `   ${entityName}: ${entityTotal} total (${
          entityMetric.successCount
        } ✓, ${entityMetric.failureCount} ✗) - ${entityRate.toFixed(
          1
        )}% success - ${(entityDuration / 1000).toFixed(2)}s\n`;
      }
    }

    return summary;
  }
}
