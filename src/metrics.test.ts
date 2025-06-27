import { MetricsCollector } from './metrics';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('initialization', () => {
    it('should initialize with zero counts', () => {
      expect(metrics.getTotalProcessed()).toBe(0);
      expect(metrics.getSuccessRate()).toBe(0);
    });

    it('should have a start time', () => {
      expect(metrics.getDurationMs()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('entity processing', () => {
    it('should start entity processing', () => {
      metrics.startEntityProcessing('testEntity');
      const entityMetric = metrics.getEntityMetrics('testEntity');
      
      expect(entityMetric).toBeDefined();
      expect(entityMetric?.entityName).toBe('testEntity');
      expect(entityMetric?.successCount).toBe(0);
      expect(entityMetric?.failureCount).toBe(0);
      expect(entityMetric?.startTime).toBeGreaterThan(0);
      expect(entityMetric?.endTime).toBeUndefined();
    });

    it('should not create duplicate entity metrics', () => {
      metrics.startEntityProcessing('testEntity');
      metrics.startEntityProcessing('testEntity');
      
      const entityMetric = metrics.getEntityMetrics('testEntity');
      expect(entityMetric).toBeDefined();
    });

    it('should finish entity processing', () => {
      metrics.startEntityProcessing('testEntity');
      metrics.finishEntityProcessing('testEntity');
      
      const entityMetric = metrics.getEntityMetrics('testEntity');
      expect(entityMetric?.endTime).toBeGreaterThan(0);
    });
  });

  describe('success and failure recording', () => {
    beforeEach(() => {
      metrics.startEntityProcessing('testEntity');
    });

    it('should record successes', () => {
      metrics.recordSuccess('testEntity');
      metrics.recordSuccess('testEntity');
      
      const entityMetric = metrics.getEntityMetrics('testEntity');
      expect(entityMetric?.successCount).toBe(2);
      expect(entityMetric?.failureCount).toBe(0);
      expect(metrics.getTotalProcessed()).toBe(2);
    });

    it('should record failures', () => {
      metrics.recordFailure('testEntity');
      metrics.recordFailure('testEntity');
      
      const entityMetric = metrics.getEntityMetrics('testEntity');
      expect(entityMetric?.successCount).toBe(0);
      expect(entityMetric?.failureCount).toBe(2);
      expect(metrics.getTotalProcessed()).toBe(2);
    });

    it('should record mixed results', () => {
      metrics.recordSuccess('testEntity');
      metrics.recordFailure('testEntity');
      metrics.recordSuccess('testEntity');
      
      const entityMetric = metrics.getEntityMetrics('testEntity');
      expect(entityMetric?.successCount).toBe(2);
      expect(entityMetric?.failureCount).toBe(1);
      expect(metrics.getTotalProcessed()).toBe(3);
    });

    it('should handle unknown entity gracefully', () => {
      expect(() => {
        metrics.recordSuccess('unknownEntity');
      }).not.toThrow();
      
      expect(metrics.getTotalProcessed()).toBe(0);
    });
  });

  describe('multiple entities', () => {
    beforeEach(() => {
      metrics.startEntityProcessing('entity1');
      metrics.startEntityProcessing('entity2');
    });

    it('should track multiple entities separately', () => {
      metrics.recordSuccess('entity1');
      metrics.recordSuccess('entity1');
      metrics.recordFailure('entity2');
      
      const entity1Metrics = metrics.getEntityMetrics('entity1');
      const entity2Metrics = metrics.getEntityMetrics('entity2');
      
      expect(entity1Metrics?.successCount).toBe(2);
      expect(entity1Metrics?.failureCount).toBe(0);
      expect(entity2Metrics?.successCount).toBe(0);
      expect(entity2Metrics?.failureCount).toBe(1);
      expect(metrics.getTotalProcessed()).toBe(3);
    });
  });

  describe('success rate calculation', () => {
    beforeEach(() => {
      metrics.startEntityProcessing('testEntity');
    });

    it('should calculate 100% success rate', () => {
      metrics.recordSuccess('testEntity');
      metrics.recordSuccess('testEntity');
      
      expect(metrics.getSuccessRate()).toBe(100);
    });

    it('should calculate 0% success rate', () => {
      metrics.recordFailure('testEntity');
      metrics.recordFailure('testEntity');
      
      expect(metrics.getSuccessRate()).toBe(0);
    });

    it('should calculate partial success rate', () => {
      metrics.recordSuccess('testEntity');
      metrics.recordFailure('testEntity');
      metrics.recordFailure('testEntity');
      
      expect(metrics.getSuccessRate()).toBeCloseTo(33.3, 1);
    });

    it('should return 0% for no processed items', () => {
      expect(metrics.getSuccessRate()).toBe(0);
    });
  });

  describe('summary generation', () => {
    it('should generate summary for empty metrics', () => {
      const summary = metrics.generateSummary();
      
      expect(summary).toContain('Total Processed: 0');
      expect(summary).toContain('Successes: 0');
      expect(summary).toContain('Failures: 0');
      expect(summary).toContain('Success Rate: 0.0%');
      expect(summary).toContain('Duration:');
    });

    it('should generate summary with single entity', () => {
      metrics.startEntityProcessing('testEntity');
      metrics.recordSuccess('testEntity');
      metrics.recordFailure('testEntity');
      metrics.finishEntityProcessing('testEntity');
      
      const summary = metrics.generateSummary();
      
      expect(summary).toContain('Total Processed: 2');
      expect(summary).toContain('Successes: 1');
      expect(summary).toContain('Failures: 1');
      expect(summary).toContain('Success Rate: 50.0%');
    });

    it('should generate summary with multiple entities', () => {
      metrics.startEntityProcessing('entity1');
      metrics.recordSuccess('entity1');
      metrics.finishEntityProcessing('entity1');
      
      metrics.startEntityProcessing('entity2');
      metrics.recordFailure('entity2');
      metrics.finishEntityProcessing('entity2');
      
      const summary = metrics.generateSummary();
      
      expect(summary).toContain('Total Processed: 2');
      expect(summary).toContain('Per-Entity Breakdown');
      expect(summary).toContain('entity1:');
      expect(summary).toContain('entity2:');
    });
  });

  describe('finish processing', () => {
    it('should set end time and return metrics', () => {
      metrics.startEntityProcessing('testEntity');
      metrics.recordSuccess('testEntity');
      
      const finalMetrics = metrics.finishProcessing();
      
      expect(finalMetrics.endTime).toBeGreaterThan(0);
      expect(finalMetrics.totalEntities).toBe(1);
      expect(finalMetrics.totalSuccesses).toBe(1);
      expect(finalMetrics.totalFailures).toBe(0);
      expect(finalMetrics.entityMetrics.size).toBe(1);
    });
  });
});