export type CanonicalEntityKind =
  | 'module'
  | 'class'
  | 'function'
  | 'variable'
  | 'code-block'
  | 'method'
  | 'property';

export type CodeEntityKind = CanonicalEntityKind;

export type EntityId = string;

export interface CodeDefinition {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface CodeEntity {
  id: EntityId;
  kind: CodeEntityKind;
  subKind?: string;
  languageId?: string;
  name: string;
  definition: CodeDefinition;
  exported: boolean;
  parent: EntityId | null;
  children: EntityId[];
  canExplode: boolean;
  sourceText?: string;
}

export interface CodeModule extends CodeEntity {
  kind: 'module';
  parent: null;
  members: EntityId[];
}

export interface CodeClass extends CodeEntity {
  kind: 'class';
  members: EntityId[];
  extends?: SymbolReference;
  implements?: SymbolReference[];
}

export interface CodeFunction extends CodeEntity {
  kind: 'function';
  parameters: ParameterInfo[];
  returnType?: string;
}

export interface CodeTypeAlias extends CodeEntity {
  kind: 'variable';
  subKind: 'type-alias';
  typeText: string;
}

export interface CodeInterface extends CodeEntity {
  kind: 'class';
  subKind: 'interface';
  members: EntityId[];
  extends?: SymbolReference[];
}

export interface CodeEnum extends CodeEntity {
  kind: 'class';
  subKind: 'enum';
  members: string[];
}

export interface CodeVariable extends CodeEntity {
  kind: 'variable';
  declarationKind: 'const' | 'let' | 'var';
  typeText?: string;
}

export interface CodeBlock extends CodeEntity {
  kind: 'code-block';
  canExplode: false;
}

export interface CodeMethod extends CodeEntity {
  kind: 'method';
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  parameters: ParameterInfo[];
  returnType?: string;
}

export interface CodeProperty extends CodeEntity {
  kind: 'property';
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  typeText?: string;
}

export interface ParameterInfo {
  name: string;
  typeText?: string;
  isOptional: boolean;
}

export interface SymbolReference {
  symbolName: string;
  resolvedEntityId: EntityId | null;
}

export interface ImportedSymbol {
  symbolName: string;
  alias?: string;
  moduleSpecifier: string;
  resolvedModuleId: EntityId | null;
  isTypeOnly: boolean;
  isDefault: boolean;
  isNamespace: boolean;
}

export type UsageContext =
  | 'type-annotation'
  | 'instantiation'
  | 'call'
  | 'reference'
  | 'extends'
  | 'implements';

export interface SymbolUsage {
  location: CodeDefinition;
  context: UsageContext;
}

export interface Dependency {
  source: EntityId;
  target: EntityId;
  importedSymbol: ImportedSymbol;
  usages: SymbolUsage[];
}

export interface ExternalModule {
  moduleSpecifier: string;
  importedSymbols: ImportedSymbol[];
  isNodeBuiltin: boolean;
}

export interface CodeGraph {
  entities: Map<EntityId, CodeEntity>;
  dependencies: Dependency[];
  modules: EntityId[];
  externalModules: ExternalModule[];
}

export interface SerializedCodeGraph {
  entities: Record<string, CodeEntity>;
  dependencies: Dependency[];
  modules: EntityId[];
  externalModules: ExternalModule[];
}

export interface ParseOptions {
  tsConfigPath?: string;
  tsConfigPaths?: string[];
  include?: string[];
  exclude?: string[];
  followAliases?: boolean;
}
