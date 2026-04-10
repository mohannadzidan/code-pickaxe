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
  ts,
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
  SerializedCodeGraph,
} from './types.js';
import type { ParsingEngine as ParsingEngineContract } from './contracts.js';

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

export class TypeScriptParsingEngine implements ParsingEngineContract {
  readonly languageId = 'typescript';
  private readonly compilerOptionsCache = new Map<string, ts.CompilerOptions>();
  private readonly nearestTsConfigCache = new Map<string, string | null>();

  async parse(projectPath: string, options?: ParseOptions): Promise<SerializedCodeGraph> {
    const graph = await this.parseCodeGraph(projectPath, options);
    console.log()
    return {
      entities: Object.fromEntries(graph.entities),
      dependencies: graph.dependencies,
      modules: graph.modules,
      externalModules: graph.externalModules,
    };
  }

  private async parseCodeGraph(rootDir: string, options?: ParseOptions): Promise<CodeGraph> {
    const absRootDir = normalizePath(path.resolve(rootDir));
    this.compilerOptionsCache.clear();
    this.nearestTsConfigCache.clear();

    const requestedTsConfigs = options?.tsConfigPaths
      ? options.tsConfigPaths
      : options?.tsConfigPath
        ? [options.tsConfigPath]
        : this.findTsConfigPaths(absRootDir);

    const tsConfigPaths = requestedTsConfigs
      .map((p) => normalizePath(path.resolve(absRootDir, p)))
      .filter((p) => fs.existsSync(p));
    const tsConfigSet = new Set(tsConfigPaths);

    const project = new Project({
      compilerOptions: { allowJs: false, strict: false },
      skipAddingFilesFromTsConfig: true,
    });

    if (tsConfigPaths.length > 0) {
      for (const configPath of tsConfigPaths) {
        project.addSourceFilesFromTsConfig(configPath);
      }
    } else {
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
        const resolved = this.resolveSpecifier(
          sym.moduleSpecifier,
          sf,
          filePathToModuleId,
          absRootDir,
          tsConfigSet
        );
        if (resolved) {
          sym.resolvedModuleId = resolved;
            sym.resolvedEntityId = this.resolveImportedEntityId(sym, entities);
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
            const target = sym.resolvedEntityId ?? sym.resolvedModuleId ?? `external:${this.packageName(sym.moduleSpecifier)}`;

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
            languageId: this.languageId,
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

          const target = sym.resolvedEntityId ?? sym.resolvedModuleId ?? `external:${this.packageName(sym.moduleSpecifier)}`;
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

    private resolveImportedEntityId(
      symbol: ImportedSymbol,
      entities: Map<EntityId, CodeEntity>
    ): EntityId | null {
      const moduleId = symbol.resolvedModuleId;
      if (!moduleId) return null;
      if (symbol.isNamespace || symbol.symbolName === '*') return null;

      const moduleEntity = entities.get(moduleId);
      if (!moduleEntity || moduleEntity.kind !== 'module' || !("members" in moduleEntity)) return null;

      const members = (moduleEntity as CodeModule).members
        .map((memberId) => entities.get(memberId))
        .filter((member): member is CodeEntity => Boolean(member));

      if (symbol.isDefault) {
        const defaultMember = members.find(
          (member) => member.exported && (member.sourceText?.includes('export default') ?? false)
        );
        return defaultMember?.id ?? null;
      }

      const namedMember = members.find(
        (member) => member.exported && member.name === symbol.symbolName
      );
      return namedMember?.id ?? null;
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

    const findModuleAncestor = (id: EntityId): EntityId | null => {
      let current: EntityId | null = id;
      while (current) {
        const entity = entities.get(current);
        if (!entity) return null;
        if (entity.kind === 'module') return entity.id;
        current = entity.parent;
      }
      return null;
    };

    // Keep exported declarations if they belong to a module that survived dependency filtering.
    // This preserves visible module APIs (e.g. exported type aliases) when modules are exploded.
    for (const [id, entity] of entities.entries()) {
      if (!entity.exported || entity.kind === 'module') continue;
      const moduleId = findModuleAncestor(id);
      if (moduleId && keep.has(moduleId)) {
        keep.add(id);
      }
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
      const filteredEntity: CodeEntity = {
        ...entity,
        children: entity.children.filter((childId) => keep.has(childId)),
        ...('members' in entity
          ? { members: (entity as { members: string[] }).members.filter((memberId) => keep.has(memberId)) }
          : {}),
      };
      filteredEntities.set(id, filteredEntity);
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
      languageId: this.languageId,
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
        languageId: this.languageId,
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
          languageId: this.languageId,
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
          languageId: this.languageId,
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
        languageId: this.languageId,
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
        kind: 'variable',
        subKind: 'type-alias',
        languageId: this.languageId,
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
        kind: 'class',
        subKind: 'interface',
        languageId: this.languageId,
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
        kind: 'class',
        subKind: 'enum',
        languageId: this.languageId,
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
          languageId: this.languageId,
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
        languageId: this.languageId,
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
    let syntheticIndex = 0;

    const nextSyntheticLocal = (prefix: string): string => {
      syntheticIndex += 1;
      return `__${prefix}_${syntheticIndex}`;
    };

    const addImport = (localName: string, symbol: ImportedSymbol): void => {
      importMap.set(localName, symbol);
    };

    const unwrapImportExpr = (expr: Node | undefined): Node | undefined => {
      if (!expr) return expr;
      if (Node.isAwaitExpression(expr)) return expr.getExpression();
      if (Node.isParenthesizedExpression(expr)) return unwrapImportExpr(expr.getExpression());
      if (Node.isVoidExpression(expr)) return unwrapImportExpr(expr.getExpression());
      return expr;
    };

    const tryGetRequireSpecifier = (expr: Node | undefined): string | null => {
      const unwrapped = unwrapImportExpr(expr);
      if (!unwrapped || !Node.isCallExpression(unwrapped)) return null;
      if (unwrapped.getExpression().getText() !== 'require') return null;
      const firstArg = unwrapped.getArguments()[0];
      if (!firstArg || !Node.isStringLiteral(firstArg)) return null;
      return firstArg.getLiteralValue();
    };

    const tryGetDynamicImportSpecifier = (expr: Node | undefined): string | null => {
      const unwrapped = unwrapImportExpr(expr);
      if (!unwrapped || !Node.isCallExpression(unwrapped)) return null;
      if (unwrapped.getExpression().getKind() !== SyntaxKind.ImportKeyword) return null;
      const firstArg = unwrapped.getArguments()[0];
      if (!firstArg || !Node.isStringLiteral(firstArg)) return null;
      return firstArg.getLiteralValue();
    };

    const addBindingImportSymbols = (
      nameNode: Node,
      moduleSpecifier: string,
      options: { isTypeOnly: boolean; isDefault: boolean; isNamespace: boolean; symbolName?: string }
    ): void => {
      if (Node.isIdentifier(nameNode)) {
        const localName = nameNode.getText();
        addImport(localName, {
          symbolName: options.symbolName ?? localName,
          moduleSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly: options.isTypeOnly,
          isDefault: options.isDefault,
          isNamespace: options.isNamespace,
        });
        return;
      }

      if (Node.isObjectBindingPattern(nameNode)) {
        for (const el of nameNode.getElements()) {
          const local = el.getNameNode();
          if (!Node.isIdentifier(local)) continue;
          const propertyName = el.getPropertyNameNode()?.getText() ?? el.getName();
          addImport(local.getText(), {
            symbolName: propertyName,
            moduleSpecifier,
            resolvedModuleId: null,
            resolvedEntityId: null,
            isTypeOnly: options.isTypeOnly,
            isDefault: false,
            isNamespace: false,
          });
        }
      }
    };

    for (const importDecl of sf.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const isTypeOnly = importDecl.isTypeOnly();

      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const localName = defaultImport.getText();
        addImport(localName, {
          symbolName: 'default',
          alias: localName,
          moduleSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly,
          isDefault: true,
          isNamespace: false,
        });
      }

      // Namespace import (import * as X)
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const localName = namespaceImport.getText();
        addImport(localName, {
          symbolName: '*',
          alias: localName,
          moduleSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
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
        addImport(localName, {
          symbolName,
          alias: alias !== symbolName ? alias : undefined,
          moduleSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly: isTypeOnly || named.isTypeOnly(),
          isDefault: false,
          isNamespace: false,
        });
      }
    }

    // TypeScript import-equals syntax: import X = require("mod")
    for (const stmt of sf.getStatements()) {
      if (!Node.isImportEqualsDeclaration(stmt)) continue;
      const moduleRef = stmt.getModuleReference();
      if (!Node.isExternalModuleReference(moduleRef)) continue;
      const expr = moduleRef.getExpression();
      if (!expr || !Node.isStringLiteral(expr)) continue;

      const moduleSpecifier = expr.getLiteralValue();
      const localName = stmt.getName();
      addImport(localName, {
        symbolName: '*',
        alias: localName,
        moduleSpecifier,
        resolvedModuleId: null,
        resolvedEntityId: null,
        isTypeOnly: false,
        isDefault: false,
        isNamespace: true,
      });
    }

    // Re-exports: export { X } from "mod", export * from "mod", export * as ns from "mod"
    for (const exportDecl of sf.getExportDeclarations()) {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;

      const named = exportDecl.getNamedExports();
      if (named.length > 0) {
        for (const n of named) {
          const symbolName = n.getName();
          const alias = n.getAliasNode()?.getText();
          addImport(nextSyntheticLocal('reexport'), {
            symbolName,
            alias: alias !== symbolName ? alias : undefined,
            moduleSpecifier,
            resolvedModuleId: null,
            resolvedEntityId: null,
            isTypeOnly: exportDecl.isTypeOnly(),
            isDefault: false,
            isNamespace: false,
          });
        }
      }

      const namespaceExport = exportDecl.getNamespaceExport();
      if (namespaceExport) {
        const alias = namespaceExport.getName();
        addImport(nextSyntheticLocal('reexport_ns'), {
          symbolName: '*',
          alias,
          moduleSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly: exportDecl.isTypeOnly(),
          isDefault: false,
          isNamespace: true,
        });
        continue;
      }

      if (named.length === 0) {
        addImport(nextSyntheticLocal('reexport_all'), {
          symbolName: '*',
          moduleSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly: exportDecl.isTypeOnly(),
          isDefault: false,
          isNamespace: true,
        });
      }
    }

    // CommonJS require() and dynamic import() bindings in variable declarations
    // (top-level and function-scoped).
    for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = decl.getInitializer();
      const requireSpecifier = tryGetRequireSpecifier(init);
      if (requireSpecifier) {
        addBindingImportSymbols(decl.getNameNode(), requireSpecifier, {
          isTypeOnly: false,
          isDefault: true,
          isNamespace: true,
        });
        continue;
      }

      const dynSpecifier = tryGetDynamicImportSpecifier(init);
      if (dynSpecifier) {
        addBindingImportSymbols(decl.getNameNode(), dynSpecifier, {
          isTypeOnly: false,
          isDefault: false,
          isNamespace: true,
          symbolName: '*',
        });
      }
    }

    // Side-effect require()/import() (no local binding): attribute to module code-block.
    for (const stmt of sf.getStatements()) {
      if (!Node.isExpressionStatement(stmt)) continue;
      const expr = stmt.getExpression();
      const requireSpecifier = tryGetRequireSpecifier(expr);
      if (requireSpecifier) {
        addImport(nextSyntheticLocal('require_side_effect'), {
          symbolName: '*',
          moduleSpecifier: requireSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly: false,
          isDefault: false,
          isNamespace: true,
        });
        continue;
      }

      const dynSpecifier = tryGetDynamicImportSpecifier(expr);
      if (dynSpecifier) {
        addImport(nextSyntheticLocal('dynamic_import_side_effect'), {
          symbolName: '*',
          moduleSpecifier: dynSpecifier,
          resolvedModuleId: null,
          resolvedEntityId: null,
          isTypeOnly: false,
          isDefault: false,
          isNamespace: true,
        });
      }
    }

    return importMap;
  }

  private resolveSpecifier(
    specifier: string,
    sf: SourceFile,
    filePathToModuleId: Map<string, EntityId>,
    rootDir: string,
    tsConfigSet: Set<string>
  ): EntityId | null {
    const importDecl = sf.getImportDeclarations().find(
      (decl) => decl.getModuleSpecifierValue() === specifier
    );
    const resolvedSourceFile = importDecl?.getModuleSpecifierSourceFile();
    if (resolvedSourceFile) {
      const resolvedModuleId = filePathToModuleId.get(normalizePath(resolvedSourceFile.getFilePath()));
      if (resolvedModuleId) return resolvedModuleId;
    }

    const containingFile = normalizePath(sf.getFilePath());
    const nearestTsConfigPath = this.findNearestTsConfig(containingFile, rootDir, tsConfigSet);
    if (nearestTsConfigPath) {
      const compilerOptions = this.getCompilerOptions(nearestTsConfigPath);
      const resolvedModule = ts.resolveModuleName(
        specifier,
        containingFile,
        compilerOptions,
        ts.sys
      ).resolvedModule;

      if (resolvedModule?.resolvedFileName) {
        const resolvedFile = normalizePath(resolvedModule.resolvedFileName);
        const moduleId =
          filePathToModuleId.get(resolvedFile) ??
          filePathToModuleId.get(resolvedFile.replace(/\.d\.ts$/, '.ts'));

        if (moduleId) return moduleId;
      }
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

  private findTsConfigPaths(rootDir: string): string[] {
    const results: string[] = [];
    const excludedDirs = new Set(['node_modules', 'dist', '.git', '.turbo']);

    const visit = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (excludedDirs.has(entry.name)) continue;
          visit(fullPath);
          continue;
        }

        if (entry.isFile() && entry.name === 'tsconfig.json') {
          results.push(normalizePath(fullPath));
        }
      }
    };

    visit(rootDir);

    return results;
  }

  private findNearestTsConfig(
    filePath: string,
    rootDir: string,
    tsConfigSet: Set<string>
  ): string | null {
    const fileDir = normalizePath(path.dirname(filePath));
    const cached = this.nearestTsConfigCache.get(fileDir);
    if (cached !== undefined) return cached;

    const normalizedRoot = normalizePath(rootDir);
    let current = fileDir;

    while (true) {
      const candidate = normalizePath(path.join(current, 'tsconfig.json'));
      if (tsConfigSet.has(candidate)) {
        this.nearestTsConfigCache.set(fileDir, candidate);
        return candidate;
      }

      if (current === normalizedRoot) break;
      const parent = normalizePath(path.dirname(current));
      if (parent === current) break;
      current = parent;
    }

    this.nearestTsConfigCache.set(fileDir, null);
    return null;
  }

  private getCompilerOptions(tsConfigPath: string): ts.CompilerOptions {
    const cached = this.compilerOptionsCache.get(tsConfigPath);
    if (cached) return cached;

    const readResult = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
    if (readResult.error) {
      this.compilerOptionsCache.set(tsConfigPath, {});
      return {};
    }

    const parsed = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      path.dirname(tsConfigPath),
      undefined,
      tsConfigPath
    );

    this.compilerOptionsCache.set(tsConfigPath, parsed.options);
    return parsed.options;
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
        if (entity.subKind === 'interface') {
          return sf.getInterface(name) ?? undefined;
        }
        if (entity.subKind === 'enum') {
          return sf.getEnum(name) ?? undefined;
        }
        return sf.getClass(name) ?? undefined;
      case 'function':
        return sf.getFunction(name) ?? undefined;
      case 'variable': {
        if (entity.subKind === 'type-alias') {
          return sf.getTypeAlias(name) ?? undefined;
        }
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

export { TypeScriptParsingEngine as ParsingEngine };
