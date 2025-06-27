export interface EntityMetrics {
  entityName: string;
  successCount: number;
  failureCount: number;
  startTime: number;
  endTime?: number;
}

export interface ProcessingMetrics {
  totalEntities: number;
  totalSuccesses: number;
  totalFailures: number;
  entityMetrics: Map<string, EntityMetrics>;
  requestDurations: number[];
  startTime: number;
  endTime?: number;
}

export class MetricsCollector {
  private metrics: ProcessingMetrics;

  constructor() {
    this.metrics = {
      totalEntities: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      entityMetrics: new Map(),
      requestDurations: [],
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

  finishProcessing(): ProcessingMetrics {
    this.metrics.endTime = Date.now();
    return { ...this.metrics };
  }

  getEntityMetrics(entityName: string): EntityMetrics | undefined {
    return this.metrics.entityMetrics.get(entityName);
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

    if (this.metrics.entityMetrics.size > 1) {
      summary += `\n📋 Per-Entity Breakdown:\n`;
      for (const [entityName, entityMetric] of this.metrics.entityMetrics) {
        const entityTotal = entityMetric.successCount + entityMetric.failureCount;
        const entityRate = entityTotal > 0 ? (entityMetric.successCount / entityTotal) * 100 : 0;
        const entityDuration = entityMetric.endTime ? entityMetric.endTime - entityMetric.startTime : 0;
        
        summary += `   ${entityName}: ${entityTotal} total (${entityMetric.successCount} ✓, ${entityMetric.failureCount} ✗) - ${entityRate.toFixed(1)}% success - ${(entityDuration / 1000).toFixed(2)}s\n`;
      }
    }

    return summary;
  }
}