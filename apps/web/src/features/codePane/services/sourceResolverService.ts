import type { CodeDefinition, SerializedCodeGraph } from "@api/parsing/types";

export type ResolvedSource = {
  moduleId: string;
  code: string;
};

export class SourceResolverService {
  findModuleId(entityId: string, graph: SerializedCodeGraph): string {
    let current = entityId;
    while (true) {
      const entity = graph.entities[current];
      if (!entity) return current;
      if (entity.kind === "module") return current;
      if (!entity.parent) return current;
      current = entity.parent;
    }
  }

  resolveEntitySource(entityId: string, graph: SerializedCodeGraph): ResolvedSource | null {
    const moduleId = this.findModuleId(entityId, graph);
    const moduleEntity = graph.entities[moduleId];
    if (!moduleEntity?.sourceText) return null;

    return {
      moduleId,
      code: moduleEntity.sourceText,
    };
  }

  resolveLocationSource(location: CodeDefinition, graph: SerializedCodeGraph): ResolvedSource | null {
    const moduleId = Object.keys(graph.entities).find((id) => {
      const entity = graph.entities[id];
      return entity?.kind === "module" && entity.definition?.file === location.file;
    });

    if (!moduleId) return null;
    const moduleEntity = graph.entities[moduleId];
    if (!moduleEntity?.sourceText) return null;

    return {
      moduleId,
      code: moduleEntity.sourceText,
    };
  }
}
