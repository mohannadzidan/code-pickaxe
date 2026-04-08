import path from 'path';
import fs from 'fs';
import {
  Project,
  SourceFile,
  Node,
  Identifier,
  SyntaxKind,
  MethodDeclaration,
  PropertyDeclaration,
} from 'ts-morph';

import type {
  CodeEntity,
  CodeModule,
  CodeClass,
  CodeFunction,
  CodeMethod,
  CodeProperty,
  CodeBlock,
  CodeTypeAlias,
  CodeInterface,
  CodeEnum,
  CodeVariable,
  CodeGraph,
  Dependency,
  EntityId,
  ImportedSymbol,
  ParameterInfo,
  ParseOptions,
  SymbolReference,
  SymbolUsage,
  UsageContext,
  ExternalModule,
  CodeDefinition,
} from './types.js';

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib',
]);

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function getCodeDef(node: Node): CodeDefinition {
  const sf = node.getSourceFile();
  const start = node.getStart();
  const end = node.getEnd();
  const startLineCol = sf.getLineAndColumnAtPos(start);
  const endLineCol = sf.getLineAndColumnAtPos(end);
  return {
    file: normalizePath(sf.getFilePath()),
    line: startLineCol.line,
    column: startLineCol.column,
    endLine: endLineCol.line,
    endColumn: endLineCol.column,
  };
}

export class ParsingEngine {
  async parse(rootDir: string, options?: ParseOptions): Promise<CodeGraph> {
    const absRootDir = normalizePath(path.resolve(rootDir));
    const tsConfigPath = options?.tsConfigPath ?? path.join(absRootDir, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsConfigPath);

    const project = new Project(
      hasTsConfig
        ? { tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false }
        : { compilerOptions: { allowJs: false, strict: false } }
    );

    if (!hasTsConfig) {
      project.addSourceFilesAtPaths(`${absRootDir}/**/*.ts`);
      project.addSourceFilesAtPaths(`${absRootDir}/**/*.tsx`);
    }

    const entities = new Map<EntityId, CodeEntity>();
    const allDependencies: Dependency[] = [];
    const moduleIds: EntityId[] = [];
    const externalModulesMap = new Map<string, ExternalModule>();

    // Build a map from absolute file path → moduleId for internal resolution
    const filePathToModuleId = new Map<string, EntityId>();
    const sourceFiles = project.getSourceFiles().filter(sf => {
      const fp = normalizePath(sf.getFilePath());
      return fp.startsWith(absRootDir) && !fp.includes('/node_modules/') && !fp.includes('/dist/');
    });

    // Pass 1: build entities
    for (const sf of sourceFiles) {
      const moduleId = this.getModuleId(sf, absRootDir);
      filePathToModuleId.set(normalizePath(sf.getFilePath()), moduleId);

      const module = this.buildModuleEntity(sf, absRootDir);
      entities.set(moduleId, module);
      moduleIds.push(moduleId);

      this.buildDeclarations(sf, module, entities);
    }

    // Pass 2 & 3: imports + dependency attribution
    for (const sf of sourceFiles) {
      const moduleId = this.getModuleId(sf, absRootDir);
      const importMap = this.buildImportMap(sf);

      // Resolve specifiers and update resolvedModuleId
      for (const [, sym] of importMap) {
        const resolved = this.resolveSpecifier(sym.moduleSpecifier, sf, filePathToModuleId);
        if (resolved) {
          sym.resolvedModuleId = resolved;
        } else {
          // External module
          const specifier = this.packageName(sym.moduleSpecifier);
          if (!externalModulesMap.has(specifier)) {
            externalModulesMap.set(specifier, {
              moduleSpecifier: specifier,
              importedSymbols: [],
              isNodeBuiltin: NODE_BUILTINS.has(specifier) || specifier.startsWith('node:'),
            });
          }
          externalModulesMap.get(specifier)!.importedSymbols.push(sym);
        }
      }

      if (importMap.size === 0) continue;

      // Collect all declaration entities that belong to this module
      const moduleEntity = entities.get(moduleId) as CodeModule;
      const declIds = moduleEntity.members;

      // Track which import names are claimed by declarations
      const claimedImports = new Map<string, Set<EntityId>>();

      for (const declId of declIds) {
        const declEntity = entities.get(declId);
        if (!declEntity || declEntity.kind === 'code-block') continue;

        // Get the ts-morph node for this declaration
        const declNode = this.findDeclNode(sf, declEntity);
        if (!declNode) continue;

        const usagesMap = this.attributeUsages(declNode, importMap);
        for (const [localName, usages] of usagesMap) {
          const sym = importMap.get(localName)!;
          const target = sym.resolvedModuleId ?? `external:${this.packageName(sym.moduleSpecifier)}`;

          if (!claimedImports.has(localName)) claimedImports.set(localName, new Set());
          claimedImports.get(localName)!.add(declId);

          allDependencies.push({
            source: declId,
            target,
            importedSymbol: sym,
            usages,
          });
        }
      }

      // Unclaimed imports go to __code__ block
      for (const [localName, sym] of importMap) {
        if (claimedImports.has(localName)) continue;
        const codeBlockId = `${moduleId}::__code__` as EntityId;

        // Ensure code-block exists
        if (!entities.has(codeBlockId)) {
          const cb: CodeBlock = {
            id: codeBlockId,
            kind: 'code-block',
            name: '__code__',
            definition: getCodeDef(sf),
            exported: false,
            parent: moduleId,
            children: [],
            canExplode: false,
          };
          entities.set(codeBlockId, cb);
          moduleEntity.members.push(codeBlockId);
          moduleEntity.children.push(codeBlockId);
        }

        const target = sym.resolvedModuleId ?? `external:${this.packageName(sym.moduleSpecifier)}`;
        allDependencies.push({
          source: codeBlockId,
          target,
          importedSymbol: sym,
          usages: [],
        });
      }
    }

    return this.filterIsolatedGraph({
      entities,
      dependencies: allDependencies,
      modules: moduleIds,
      externalModules: Array.from(externalModulesMap.values()),
    });
  }

  private filterIsolatedGraph(graph: CodeGraph): CodeGraph {
    const { entities, dependencies, modules, externalModules } = graph;

    const degree = new Map<EntityId, number>();
    for (const id of entities.keys()) degree.set(id, 0);

    for (const dep of dependencies) {
      if (entities.has(dep.source)) {
        degree.set(dep.source, (degree.get(dep.source) ?? 0) + 1);
      }
      if (entities.has(dep.target)) {
        degree.set(dep.target, (degree.get(dep.target) ?? 0) + 1);
      }
    }

    const keep = new Set<EntityId>();
    for (const [id, d] of degree.entries()) {
      if (d > 0) keep.add(id);
    }

    // Keep ancestor chain so surviving children remain reachable from their module/class parents.
    for (const id of Array.from(keep)) {
      let cur: EntityId | null = id;
      while (cur) {
        const e = entities.get(cur);
        if (!e?.parent) break;
        keep.add(e.parent);
        cur = e.parent;
      }
    }

    const filteredEntities = new Map<EntityId, CodeEntity>();
    for (const [id, entity] of entities.entries()) {
      if (!keep.has(id)) continue;
      filteredEntities.set(id, {
        ...entity,
        children: entity.children.filter((childId) => keep.has(childId)),
      });
    }

    const filteredModules = modules.filter((id) => keep.has(id));
    const filteredDependencies = dependencies.filter((dep) => {
      if (!keep.has(dep.source)) return false;
      if (dep.target.startsWith('external:')) return true;
      return keep.has(dep.target);
    });

    const referencedExternal = new Set<string>();
    for (const dep of filteredDependencies) {
      if (dep.target.startsWith('external:')) referencedExternal.add(dep.target.slice('external:'.length));
    }
    const filteredExternalModules = externalModules.filter((ext) => referencedExternal.has(ext.moduleSpecifier));

    return {
      entities: filteredEntities,
      dependencies: filteredDependencies,
      modules: filteredModules,
      externalModules: filteredExternalModules,
    };
  }

  private getModuleId(sf: SourceFile, rootDir: string): EntityId {
    const abs = normalizePath(sf.getFilePath());
    return normalizePath(path.relative(rootDir, abs));
  }

  private buildModuleEntity(sf: SourceFile, rootDir: string): CodeModule {
    const moduleId = this.getModuleId(sf, rootDir);
    return {
      id: moduleId,
      kind: 'module',
      name: path.basename(sf.getFilePath()),
      definition: getCodeDef(sf),
      exported: true,
      parent: null,
      children: [],
      canExplode: true,
      members: [],
      sourceText: sf.getFullText(),
    };
  }

  private buildDeclarations(sf: SourceFile, module: CodeModule, entities: Map<EntityId, CodeEntity>): void {
    const moduleId = module.id;

    // Classes
    for (const cls of sf.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      const classId = `${moduleId}::${name}` as EntityId;

      const extendsExpr = cls.getExtends();
      const extendsRef: SymbolReference | undefined = extendsExpr
        ? { symbolName: extendsExpr.getExpression().getText(), resolvedEntityId: null }
        : undefined;

      const implementsRefs: SymbolReference[] = cls.getImplements().map(impl => ({
        symbolName: impl.getExpression().getText(),
        resolvedEntityId: null,
      }));

      const classEntity: CodeClass = {
        id: classId,
        kind: 'class',
        name,
        definition: getCodeDef(cls),
        exported: cls.isExported(),
        parent: moduleId,
        children: [],
        canExplode: true,
        members: [],
        extends: extendsRef,
        implements: implementsRefs.length > 0 ? implementsRefs : undefined,
        sourceText: cls.getText(),
      };

      entities.set(classId, classEntity);
      module.members.push(classId);
      module.children.push(classId);

      // Methods
      for (const method of cls.getMethods()) {
        const mName = method.getName();
        const methodId = `${classId}::${mName}` as EntityId;
        const visibility = this.getVisibility(method);
        const methodEntity: CodeMethod = {
          id: methodId,
          kind: 'method',
          name: mName,
          definition: getCodeDef(method),
          exported: false,
          parent: classId,
          children: [],
          canExplode: false,
          visibility,
          isStatic: method.isStatic(),
          parameters: this.extractParams(method),
          returnType: method.getReturnTypeNode()?.getText(),
          sourceText: method.getText(),
        };
        entities.set(methodId, methodEntity);
        classEntity.members.push(methodId);
        classEntity.children.push(methodId);
      }

      // Properties
      for (const prop of cls.getProperties()) {
        const pName = prop.getName();
        const propId = `${classId}::${pName}` as EntityId;
        const visibility = this.getPropVisibility(prop);
        const propEntity: CodeProperty = {
          id: propId,
          kind: 'property',
          name: pName,
          definition: getCodeDef(prop),
          exported: false,
          parent: classId,
          children: [],
          canExplode: false,
          visibility,
          isStatic: prop.isStatic(),
          typeText: prop.getTypeNode()?.getText(),
          sourceText: prop.getText(),
        };
        entities.set(propId, propEntity);
        classEntity.members.push(propId);
        classEntity.children.push(propId);
      }
    }

    // Functions
    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      const fnId = `${moduleId}::${name}` as EntityId;
      const fnEntity: CodeFunction = {
        id: fnId,
        kind: 'function',
        name,
        definition: getCodeDef(fn),
        exported: fn.isExported(),
        parent: moduleId,
        children: [],
        canExplode: false,
        parameters: this.extractParams(fn),
        returnType: fn.getReturnTypeNode()?.getText(),
        sourceText: fn.getText(),
      };
      entities.set(fnId, fnEntity);
      module.members.push(fnId);
      module.children.push(fnId);
    }

    // Type aliases
    for (const ta of sf.getTypeAliases()) {
      const name = ta.getName();
      const taId = `${moduleId}::${name}` as EntityId;
      const taEntity: CodeTypeAlias = {
        id: taId,
        kind: 'type-alias',
        name,
        definition: getCodeDef(ta),
        exported: ta.isExported(),
        parent: moduleId,
        children: [],
        canExplode: false,
        typeText: ta.getTypeNode()?.getText() ?? '',
        sourceText: ta.getText(),
      };
      entities.set(taId, taEntity);
      module.members.push(taId);
      module.children.push(taId);
    }

    // Interfaces
    for (const iface of sf.getInterfaces()) {
      const name = iface.getName();
      const ifaceId = `${moduleId}::${name}` as EntityId;
      const extendsRefs: SymbolReference[] = iface.getExtends().map(e => ({
        symbolName: e.getExpression().getText(),
        resolvedEntityId: null,
      }));
      const ifaceEntity: CodeInterface = {
        id: ifaceId,
        kind: 'interface',
        name,
        definition: getCodeDef(iface),
        exported: iface.isExported(),
        parent: moduleId,
        children: [],
        canExplode: false,
        members: [],
        extends: extendsRefs.length > 0 ? extendsRefs : undefined,
        sourceText: iface.getText(),
      };
      entities.set(ifaceId, ifaceEntity);
      module.members.push(ifaceId);
      module.children.push(ifaceId);
    }

    // Enums
    for (const en of sf.getEnums()) {
      const name = en.getName();
      const enId = `${moduleId}::${name}` as EntityId;
      const enEntity: CodeEnum = {
        id: enId,
        kind: 'enum',
        name,
        definition: getCodeDef(en),
        exported: en.isExported(),
        parent: moduleId,
        children: [],
        canExplode: false,
        members: en.getMembers().map(m => m.getName()),
        sourceText: en.getText(),
      };
      entities.set(enId, enEntity);
      module.members.push(enId);
      module.children.push(enId);
    }

    // Variables (top-level variable statements)
    for (const stmt of sf.getStatements()) {
      if (!Node.isVariableStatement(stmt)) continue;
      const declList = stmt.getDeclarationList();
      const declKindFlags = declList.getFlags();
      let declKind: 'const' | 'let' | 'var' = 'var';
      if (declKindFlags & 2 /* const */) declKind = 'const';
      else if (declKindFlags & 1 /* let */) declKind = 'let';

      for (const vd of declList.getDeclarations()) {
        const name = vd.getName();
        if (!name) continue;
        const varId = `${moduleId}::${name}` as EntityId;
        const varEntity: CodeVariable = {
          id: varId,
          kind: 'variable',
          name,
          definition: getCodeDef(vd),
          exported: stmt.isExported(),
          parent: moduleId,
          children: [],
          canExplode: false,
          declarationKind: declKind,
          typeText: vd.getTypeNode()?.getText(),
          sourceText: stmt.getText(),
        };
        entities.set(varId, varEntity);
        module.members.push(varId);
        module.children.push(varId);
      }
    }

    // Code block for top-level imperative statements
    const imperativeStatements = sf.getStatements().filter(stmt => {
      const kind = stmt.getKind();
      return (
        kind !== SyntaxKind.ImportDeclaration &&
        kind !== SyntaxKind.ExportDeclaration &&
        kind !== SyntaxKind.ClassDeclaration &&
        kind !== SyntaxKind.FunctionDeclaration &&
        kind !== SyntaxKind.TypeAliasDeclaration &&
        kind !== SyntaxKind.InterfaceDeclaration &&
        kind !== SyntaxKind.EnumDeclaration &&
        kind !== SyntaxKind.VariableStatement
      );
    });

    if (imperativeStatements.length > 0) {
      const cbId = `${moduleId}::__code__` as EntityId;
      const cb: CodeBlock = {
        id: cbId,
        kind: 'code-block',
        name: '__code__',
        definition: getCodeDef(imperativeStatements[0]),
        exported: false,
        parent: moduleId,
        children: [],
        canExplode: false,
      };
      entities.set(cbId, cb);
      module.members.push(cbId);
      module.children.push(cbId);
    }
  }

  private buildImportMap(sf: SourceFile): Map<string, ImportedSymbol> {
    const importMap = new Map<string, ImportedSymbol>();

    for (const importDecl of sf.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const isTypeOnly = importDecl.isTypeOnly();

      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const localName = defaultImport.getText();
        importMap.set(localName, {
          symbolName: localName,
          moduleSpecifier,
          resolvedModuleId: null,
          isTypeOnly,
          isDefault: true,
          isNamespace: false,
        });
      }

      // Namespace import (import * as X)
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const localName = namespaceImport.getText();
        importMap.set(localName, {
          symbolName: '*',
          alias: localName,
          moduleSpecifier,
          resolvedModuleId: null,
          isTypeOnly,
          isDefault: false,
          isNamespace: true,
        });
      }

      // Named imports
      for (const named of importDecl.getNamedImports()) {
        const symbolName = named.getName();
        const alias = named.getAliasNode()?.getText();
        const localName = alias ?? symbolName;
        importMap.set(localName, {
          symbolName,
          alias: alias !== symbolName ? alias : undefined,
          moduleSpecifier,
          resolvedModuleId: null,
          isTypeOnly: isTypeOnly || named.isTypeOnly(),
          isDefault: false,
          isNamespace: false,
        });
      }
    }

    return importMap;
  }

  private resolveSpecifier(
    specifier: string,
    sf: SourceFile,
    filePathToModuleId: Map<string, EntityId>
  ): EntityId | null {
    const importDecl = sf.getImportDeclarations().find(
      (decl) => decl.getModuleSpecifierValue() === specifier
    );
    const resolvedSourceFile = importDecl?.getModuleSpecifierSourceFile();
    if (resolvedSourceFile) {
      const resolvedModuleId = filePathToModuleId.get(normalizePath(resolvedSourceFile.getFilePath()));
      if (resolvedModuleId) return resolvedModuleId;
    }

    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;

    const fromDir = path.dirname(sf.getFilePath());
    const resolved = normalizePath(path.resolve(fromDir, specifier));

    const candidates = [
      resolved + '.ts',
      resolved + '/index.ts',
      resolved + '.tsx',
      resolved + '/index.tsx',
    ];

    for (const candidate of candidates) {
      const moduleId = filePathToModuleId.get(normalizePath(candidate));
      if (moduleId) return moduleId;
    }

    return null;
  }

  private attributeUsages(
    declNode: Node,
    importMap: Map<string, ImportedSymbol>
  ): Map<string, SymbolUsage[]> {
    const result = new Map<string, SymbolUsage[]>();

    const identifiers = declNode.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const id of identifiers) {
      const localName = id.getText();
      if (!importMap.has(localName)) continue;

      const ctx = this.determineContext(id);
      const sf = id.getSourceFile();
      const pos = id.getStart();
      const lc = sf.getLineAndColumnAtPos(pos);
      const endLc = sf.getLineAndColumnAtPos(id.getEnd());

      const usage: SymbolUsage = {
        location: {
          file: normalizePath(sf.getFilePath()),
          line: lc.line,
          column: lc.column,
          endLine: endLc.line,
          endColumn: endLc.column,
        },
        context: ctx,
      };

      if (!result.has(localName)) result.set(localName, []);
      result.get(localName)!.push(usage);
    }

    return result;
  }

  private determineContext(id: Identifier): UsageContext {
    const parent = id.getParent();
    if (!parent) return 'reference';

    const parentKind = parent.getKind();

    // Call: foo() or foo.bar() where foo is the callee
    if (parentKind === SyntaxKind.CallExpression) {
      const callExpr = parent.asKindOrThrow(SyntaxKind.CallExpression);
      if (callExpr.getExpression() === id) return 'call';
    }

    // Instantiation: new Foo(...)
    if (parentKind === SyntaxKind.NewExpression) {
      const newExpr = parent.asKindOrThrow(SyntaxKind.NewExpression);
      if (newExpr.getExpression() === id) return 'instantiation';
    }

    // Heritage clause: class X extends Foo / class X implements Bar
    const grandParent = parent.getParent();
    if (grandParent) {
      const gpKind = grandParent.getKind();
      if (
        gpKind === SyntaxKind.ExpressionWithTypeArguments &&
        grandParent.getParent()?.getKind() === SyntaxKind.HeritageClause
      ) {
        const heritageClause = grandParent.getParent()!.asKindOrThrow(SyntaxKind.HeritageClause);
        const token = heritageClause.getToken();
        if (token === SyntaxKind.ExtendsKeyword) return 'extends';
        if (token === SyntaxKind.ImplementsKeyword) return 'implements';
      }
    }

    // Type annotation: walk ancestors for type positions
    let cur: Node | undefined = id.getParent();
    while (cur) {
      const k = cur.getKind();
      if (
        k === SyntaxKind.TypeReference ||
        k === SyntaxKind.TypeAliasDeclaration ||
        k === SyntaxKind.InterfaceDeclaration ||
        k === SyntaxKind.TypeQuery
      ) {
        return 'type-annotation';
      }
      // Stop at statement boundaries
      if (Node.isStatement(cur)) break;
      cur = cur.getParent();
    }

    return 'reference';
  }

  private findDeclNode(sf: SourceFile, entity: CodeEntity): Node | undefined {
    const name = entity.name;
    switch (entity.kind) {
      case 'class':
        return sf.getClass(name) ?? undefined;
      case 'function':
        return sf.getFunction(name) ?? undefined;
      case 'type-alias':
        return sf.getTypeAlias(name) ?? undefined;
      case 'interface':
        return sf.getInterface(name) ?? undefined;
      case 'enum':
        return sf.getEnum(name) ?? undefined;
      case 'variable': {
        for (const stmt of sf.getStatements()) {
          if (!Node.isVariableStatement(stmt)) continue;
          const found = stmt.getDeclarationList().getDeclarations().find(d => d.getName() === name);
          if (found) return stmt;
        }
        return undefined;
      }
      case 'code-block': {
        // Return the first imperative statement (attributeUsages will scan all descendants)
        const stmts = sf.getStatements().filter(s => {
          const k = s.getKind();
          return (
            k !== SyntaxKind.ImportDeclaration &&
            k !== SyntaxKind.ExportDeclaration &&
            k !== SyntaxKind.ClassDeclaration &&
            k !== SyntaxKind.FunctionDeclaration &&
            k !== SyntaxKind.TypeAliasDeclaration &&
            k !== SyntaxKind.InterfaceDeclaration &&
            k !== SyntaxKind.EnumDeclaration &&
            k !== SyntaxKind.VariableStatement
          );
        });
        // Wrap all in a synthetic container by returning the source file if there are imperative stmts
        return stmts.length > 0 ? sf : undefined;
      }
      default:
        return undefined;
    }
  }

  private getVisibility(method: MethodDeclaration): 'public' | 'private' | 'protected' {
    if (method.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
    if (method.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
    return 'public';
  }

  private getPropVisibility(prop: PropertyDeclaration): 'public' | 'private' | 'protected' {
    if (prop.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
    if (prop.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
    return 'public';
  }

  private extractParams(node: { getParameters(): any[] }): ParameterInfo[] {
    return node.getParameters().map((p: any) => ({
      name: p.getName(),
      typeText: p.getTypeNode()?.getText(),
      isOptional: p.isOptional(),
    }));
  }

  private packageName(specifier: string): string {
    if (specifier.startsWith('@')) {
      const parts = specifier.split('/');
      return parts.slice(0, 2).join('/');
    }
    return specifier.split('/')[0];
  }
}
