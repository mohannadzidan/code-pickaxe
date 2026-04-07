# Code Pickaxe — Architecture & Interface Design

## 1. Core Mental Model

The codebase is a **hierarchical directed graph**. At the highest zoom level, you see modules (files). Zoom in, and a module breaks into its declarations (classes, functions, types, variables, raw code). Zoom into a class, and you see methods/properties. At every level, nodes have dependency edges to other nodes.

Each node can itself contain a subgraph — this is the "explode" mechanic.

## 2. Key Design Decisions

### 2.1 The "raw code" problem

Top-level imperative code (statements not inside any declaration) gets grouped into a synthetic node — a `CodeBlock` representing "top-level statements in this module that aren't part of any declaration." We track which imports those statements reference.

### 2.2 Dependency granularity

A dependency is richer than "module A depends on module B":

- **What** is imported (symbol name)
- **From where** (module specifier)
- **By whom** (which declaration uses it — or the module's raw code)
- **How** (type-only import vs value import)

The dependency edge itself carries metadata.

### 2.3 The "explode" operation

When you explode a module, you replace a single node in the graph with its internal subgraph and re-route edges. The data model must support:

- Querying a node's children (declarations inside a module, methods inside a class)
- Re-attributing dependencies from a parent to its children (module-level deps fan out to specific declarations)

### 2.4 Lazy vs eager parsing

Parse the full AST once, but build the dependency graph lazily — compute module-level deps first, then only compute declaration-level deps when the user explodes a module.

## 3. Entity Taxonomy

```
Module
├── Class
│   ├── Method
│   └── Property
├── Function
├── TypeAlias
├── Interface
├── Enum
├── Variable (exported const/let/var)
└── CodeBlock (top-level imperative statements)
```

## 4. Core Interfaces

### 4.1 Foundational Types

```ts
type CodeEntityKind =
  | 'module'
  | 'class'
  | 'function'
  | 'type-alias'
  | 'interface'
  | 'enum'
  | 'variable'
  | 'code-block'
  | 'method'
  | 'property';

type EntityId = string;
```

### 4.2 Source Location

```ts
interface CodeDefinition {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
```

### 4.3 CodeEntity — The Universal Node

Every parseable thing in the codebase is a `CodeEntity`. The hierarchy is expressed through `parent` / `children`.

```ts
interface CodeEntity {
  id: EntityId;
  kind: CodeEntityKind;
  name: string;
  definition: CodeDefinition;
  exported: boolean;
  parent: EntityId | null;
  children: EntityId[];
  canExplode: boolean;
}
```

### 4.4 Specialized Entity Interfaces

These extend `CodeEntity` with kind-specific data. The base `CodeEntity` is enough for the graph, but these carry richer info for detail views.

```ts
interface CodeModule extends CodeEntity {
  kind: 'module';
  parent: null;
  members: EntityId[];
}

interface CodeClass extends CodeEntity {
  kind: 'class';
  members: EntityId[];          // methods + properties
  extends?: SymbolReference;    // what it extends
  implements?: SymbolReference[]; // what it implements
}

interface CodeFunction extends CodeEntity {
  kind: 'function';
  parameters: ParameterInfo[];
  returnType?: string;
}

interface CodeTypeAlias extends CodeEntity {
  kind: 'type-alias';
  typeText: string;             // raw type text for display
}

interface CodeInterface extends CodeEntity {
  kind: 'interface';
  members: EntityId[];
  extends?: SymbolReference[];
}

interface CodeEnum extends CodeEntity {
  kind: 'enum';
  members: string[];            // enum member names
}

interface CodeVariable extends CodeEntity {
  kind: 'variable';
  declarationKind: 'const' | 'let' | 'var';
  typeText?: string;
}

interface CodeBlock extends CodeEntity {
  kind: 'code-block';
  canExplode: false;            // raw code cannot be broken down further
}

interface CodeMethod extends CodeEntity {
  kind: 'method';
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  parameters: ParameterInfo[];
  returnType?: string;
}

interface CodeProperty extends CodeEntity {
  kind: 'property';
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  typeText?: string;
}
```

### 4.5 Supporting Types

```ts
interface ParameterInfo {
  name: string;
  typeText?: string;
  isOptional: boolean;
}

interface SymbolReference {
  symbolName: string;
  resolvedEntityId: EntityId | null;
}
```

## 5. Dependency Model

### 5.1 Imported Symbol

```ts
interface ImportedSymbol {
  symbolName: string;
  alias?: string;
  moduleSpecifier: string;        // './linkedin', 'express'
  resolvedModuleId: EntityId | null;
  isTypeOnly: boolean;
  isDefault: boolean;
  isNamespace: boolean;
}
```

### 5.2 Dependency Edge

```ts
interface Dependency {
  source: EntityId;
  target: EntityId;
  importedSymbol: ImportedSymbol;
  usages: SymbolUsage[];
}

interface SymbolUsage {
  location: CodeDefinition;
  context: UsageContext;
}

type UsageContext =
  | 'type-annotation'
  | 'instantiation'
  | 'call'
  | 'reference'
  | 'extends'
  | 'implements';
```

## 6. The Code Graph — Top-Level Container

```ts
interface CodeGraph {
  entities: Map<EntityId, CodeEntity>;
  dependencies: Dependency[];
  modules: EntityId[];
  externalModules: ExternalModule[];
}

interface ExternalModule {
  moduleSpecifier: string;
  importedSymbols: ImportedSymbol[];
  isNodeBuiltin: boolean;
}
```

## 7. Parsing Engine Interfaces

```ts
interface ParsingEngine {
  parse(rootDir: string, options?: ParseOptions): Promise<CodeGraph>;
}

interface ParseOptions {
  tsConfigPath?: string;
  include?: string[];
  exclude?: string[];
  followAliases?: boolean;
}

interface ModuleAnalyzer {
  getDeclarations(moduleId: EntityId): CodeEntity[];
  getInternalDependencies(moduleId: EntityId): Dependency[];
}

interface DeclarationAnalyzer {
  getMembers(declarationId: EntityId): CodeEntity[];
  getMemberDependencies(declarationId: EntityId): Dependency[];
}

interface ModuleResolver {
  resolve(specifier: string, fromFile: string): ResolvedModule;
}

type ResolvedModule =
  | { kind: 'internal'; entityId: EntityId }
  | { kind: 'external'; moduleSpecifier: string; isNodeBuiltin: boolean }
  | { kind: 'unresolved'; moduleSpecifier: string; reason: string };
```

## 8. View Model — What the Web Layer Consumes

### 8.1 Graph View

```ts
interface GraphView {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

interface ViewNode {
  entityId: EntityId;
  kind: CodeEntityKind;
  label: string;
  isExploded: boolean;
  canExplode: boolean;
  children?: ViewNode[];
  metadata: ViewNodeMetadata;
}

interface ViewNodeMetadata {
  filePath: string;
  exported: boolean;
  dependencyCount: number;
  dependentCount: number;
}

interface ViewEdge {
  sourceId: EntityId;
  targetId: EntityId;
  label: string;
  symbols: string[];
  usageContexts: UsageContext[];
}
```

### 8.2 View Requests

```ts
interface GraphViewRequest {
  explodedEntities: EntityId[];
  filters?: ViewFilters;
}

interface ViewFilters {
  hideTypeOnly?: boolean;
  hideExternal?: boolean;
  showKinds?: CodeEntityKind[];
  searchQuery?: string;
}
```

## 9. API Surface

```ts
interface CodePickaxeAPI {
  loadProject(rootDir: string, options?: ParseOptions): Promise<ProjectSummary>;
  getGraphView(request: GraphViewRequest): Promise<GraphView>;
  explodeEntity(entityId: EntityId): Promise<ExplodeResult>;
  searchEntities(query: string): Promise<CodeEntity[]>;
  getEntityDetails(entityId: EntityId): Promise<EntityDetails>;
}

interface ProjectSummary {
  name: string;
  rootDir: string;
  moduleCount: number;
  externalDependencyCount: number;
  topLevelModules: EntityId[];
}

interface ExplodeResult {
  entity: CodeEntity;
  children: CodeEntity[];
  internalDependencies: Dependency[];
  externalDependencies: Dependency[];
}

interface EntityDetails {
  entity: CodeEntity;
  incomingDependencies: Dependency[];
  outgoingDependencies: Dependency[];
  sourceText: string;
}
```

## 10. Open Questions & Considerations

### 10.1 Dependency Attribution Algorithm

The trickiest part: deciding whether an import is used by the module's raw code, a specific function, or a class method. Requires walking each declaration's AST subtree and checking if any `Identifier` node references an imported symbol.

### 10.2 Barrel Files

`index.ts` files that re-export everything create phantom modules with no logic of their own. Strategy needed: show them as nodes, or collapse them transparently?

### 10.3 Circular Dependencies

Directed cycles are valid in the graph model, but the visualization layer needs layout strategies. Detect and annotate them.

### 10.4 EntityId Format

Proposed convention: `{filePath}::{declarationName}[::{memberName}]`

Examples:
- `src/adapters/registry.ts` — module
- `src/adapters/registry.ts::AdapterRegistry` — class
- `src/adapters/registry.ts::AdapterRegistry::register` — method
- `src/adapters/registry.ts::adapterRegistry` — exported variable
- `src/adapters/registry.ts::__code__` — top-level code block