import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { ParsingEngine } from './engine.js';
import type { CodeDefinition, CodeEntity, Dependency, SerializedCodeGraph } from './types.js';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function normalizeLocation(location: CodeDefinition, fixtureRoot: string): CodeDefinition {
  return {
    ...location,
    file: normalizePath(path.relative(fixtureRoot, location.file)),
  };
}

function normalizeEntity(entity: CodeEntity, fixtureRoot: string): Omit<CodeEntity, 'sourceText'> {
  return {
    ...entity,
    definition: normalizeLocation(entity.definition, fixtureRoot),
    children: [...entity.children].sort(),
  };
}

function normalizeDependency(dep: Dependency, fixtureRoot: string): Dependency {
  return {
    ...dep,
    usages: [...dep.usages]
      .map((usage) => ({
        ...usage,
        location: normalizeLocation(usage.location, fixtureRoot),
      }))
      .sort((a, b) => {
        const fileCmp = a.location.file.localeCompare(b.location.file);
        if (fileCmp !== 0) return fileCmp;
        if (a.location.line !== b.location.line) return a.location.line - b.location.line;
        if (a.location.column !== b.location.column) return a.location.column - b.location.column;
        return a.context.localeCompare(b.context);
      }),
  };
}

function normalizeGraph(graph: SerializedCodeGraph, fixtureRoot: string): SerializedCodeGraph {
  const normalizedEntities = Object.fromEntries(
    Object.entries(graph.entities)
      .map(([id, entity]) => [id, normalizeEntity(entity, fixtureRoot)])
      .sort(([a], [b]) => a.localeCompare(b))
  );

  const normalizedDependencies = [...graph.dependencies]
    .map((dep) => normalizeDependency(dep, fixtureRoot))
    .sort((a, b) => {
      const srcCmp = a.source.localeCompare(b.source);
      if (srcCmp !== 0) return srcCmp;
      const tgtCmp = a.target.localeCompare(b.target);
      if (tgtCmp !== 0) return tgtCmp;
      const modCmp = a.importedSymbol.moduleSpecifier.localeCompare(b.importedSymbol.moduleSpecifier);
      if (modCmp !== 0) return modCmp;
      return a.importedSymbol.symbolName.localeCompare(b.importedSymbol.symbolName);
    });

  const normalizedExternalModules = [...graph.externalModules]
    .map((ext) => ({
      ...ext,
      importedSymbols: [...ext.importedSymbols].sort((a, b) => {
        const symbolCmp = a.symbolName.localeCompare(b.symbolName);
        if (symbolCmp !== 0) return symbolCmp;
        return (a.alias ?? '').localeCompare(b.alias ?? '');
      }),
    }))
    .sort((a, b) => a.moduleSpecifier.localeCompare(b.moduleSpecifier));

  return {
    entities: normalizedEntities,
    dependencies: normalizedDependencies,
    modules: [...graph.modules].sort(),
    externalModules: normalizedExternalModules,
  };
}

function serializeGraph(graph: Awaited<ReturnType<ParsingEngine['parse']>>): SerializedCodeGraph {
  return {
    entities: Object.fromEntries(graph.entities.entries()),
    dependencies: graph.dependencies,
    modules: graph.modules,
    externalModules: graph.externalModules,
  };
}

function getFixtureRoots(): Array<{ name: string; root: string }> {
  const examplesRoot = path.resolve(process.cwd(), '../../examples/projects');
  const fixtures = fs
    .readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, root: path.join(examplesRoot, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return fixtures;
}

describe('ParsingEngine', () => {
  const fixtures = getFixtureRoots();

  it('discovers all example fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  it.each(fixtures)('produces a structurally valid graph for %s', async ({ name, root }) => {
    const engine = new ParsingEngine();
    const graph = await engine.parse(root);

    expect(graph.modules.length).toBeGreaterThan(0);
    expect(graph.entities.size).toBeGreaterThan(0);

    for (const moduleId of graph.modules) {
      const moduleEntity = graph.entities.get(moduleId);
      expect(moduleEntity?.kind, `${name}: module kind for ${moduleId}`).toBe('module');
    }

    for (const [entityId, entity] of graph.entities.entries()) {
      if (entity.parent) {
        expect(graph.entities.has(entity.parent), `${name}: missing parent for ${entityId}`).toBe(true);
      }

      if ('members' in entity) {
        for (const memberId of entity.members) {
          const member = graph.entities.get(memberId);
          expect(member, `${name}: missing member ${memberId}`).toBeDefined();
          expect(member?.parent, `${name}: wrong parent on member ${memberId}`).toBe(entity.id);
        }
      }

      for (const childId of entity.children) {
        const child = graph.entities.get(childId);
        expect(child, `${name}: missing child ${childId}`).toBeDefined();
        expect(child?.parent, `${name}: wrong parent on ${childId}`).toBe(entity.id);
      }
    }

    for (const dep of graph.dependencies) {
      expect(graph.entities.has(dep.source), `${name}: dangling dependency source ${dep.source}`).toBe(true);

      if (dep.importedSymbol.isDefault && !dep.importedSymbol.isNamespace) {
        expect(dep.importedSymbol.symbolName, `${name}: default import should use canonical symbolName`).toBe(
          'default'
        );
      }

      if (dep.target.startsWith('external:')) {
        const specifier = dep.target.slice('external:'.length);
        expect(
          graph.externalModules.some((ext) => ext.moduleSpecifier === specifier),
          `${name}: missing external module ${specifier}`
        ).toBe(true);
      } else {
        expect(graph.entities.has(dep.target), `${name}: dangling dependency target ${dep.target}`).toBe(true);
      }
    }
  });

  it.each(fixtures)('matches normalized graph snapshot for %s', async ({ root }) => {
    const engine = new ParsingEngine();
    const graph = await engine.parse(root);
    const normalized = normalizeGraph(serializeGraph(graph), root);

    expect(normalized).toMatchSnapshot();
  });
});
