export interface DependencyGraph {
  [entityName: string]: string[];
}

export interface ExecutionWave {
  entities: string[];
  wave: number;
}

export class DependencyResolver {
  private dependencies: DependencyGraph;
  private entities: string[];
  private allowPartialResolution: boolean;

  constructor(entities: string[], dependencies: DependencyGraph = {}, allowPartialResolution: boolean = false) {
    this.entities = entities;
    this.dependencies = dependencies;
    this.allowPartialResolution = allowPartialResolution;
  }

  resolveExecutionOrder(): ExecutionWave[] {
    const waves: ExecutionWave[] = [];
    const processed = new Set<string>();
    const inProgress = new Set<string>();
    let waveNumber = 0;

    while (processed.size < this.entities.length) {
      const currentWave: string[] = [];

      for (const entity of this.entities) {
        if (processed.has(entity) || inProgress.has(entity)) {
          continue;
        }

        const deps = this.dependencies[entity] || [];
        const canProcess = deps.every((dep) => 
          processed.has(dep) || (this.allowPartialResolution && !this.entities.includes(dep))
        );

        if (canProcess) {
          currentWave.push(entity);
          inProgress.add(entity);
        }
      }

      if (currentWave.length === 0) {
        const remaining = this.entities.filter((e) => !processed.has(e));
        throw new Error(
          `Circular dependency detected or missing dependencies for entities: ${remaining.join(
            ", "
          )}`
        );
      }

      waves.push({
        entities: currentWave,
        wave: waveNumber++,
      });

      currentWave.forEach((entity) => {
        processed.add(entity);
        inProgress.delete(entity);
      });
    }

    return waves;
  }

  validateDependencies(): string[] {
    const errors: string[] = [];
    const entitySet = new Set(this.entities);

    for (const [entity, deps] of Object.entries(this.dependencies)) {
      if (!entitySet.has(entity)) {
        errors.push(
          `Entity '${entity}' has dependencies but is not in the entity list`
        );
        continue;
      }

      for (const dep of deps) {
        if (!entitySet.has(dep)) {
          errors.push(
            `Entity '${entity}' depends on '${dep}' which does not exist`
          );
        }
      }
    }

    return errors;
  }

  getDependents(entityName: string): string[] {
    return Object.entries(this.dependencies)
      .filter(([_, deps]) => deps.includes(entityName))
      .map(([entity, _]) => entity);
  }

  getDependencies(entityName: string): string[] {
    return this.dependencies[entityName] || [];
  }
}
