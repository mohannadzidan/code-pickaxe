# Example Projects for Graph Parser Testing

These mini projects are intentionally small fixtures for import/dependency graph testing.

## Projects

- `01-basic-imports`: default + named imports from a sibling module.
- `02-type-only-imports`: `import type` and exported types/interfaces.
- `03-reexports`: `export { ... } from`, `export type { ... } from`, and `export * from`.
- `04-import-equals`: TypeScript `import X = require("...")` syntax.
- `05-commonjs-require`: CommonJS `require()` with namespace + destructuring patterns.
- `06-dynamic-import`: `await import("...")` and side-effect `import("...")`.
- `07-class-hierarchy`: classes, extends/implements, methods/properties, and constructor flow.
- `08-enum-and-variables`: enums + exported const/let variables with function usage.
- `09-top-level-code-block`: imperative module-level statements and side-effect import module.
- `10-namespace-and-barrel`: namespace import (`import * as`) with barrel re-exports.
- `11-path-aliases`: tsconfig `baseUrl` + `paths` alias resolution (`@core/*`).
- `12-circular-modules`: circular imports between modules to test cycle rendering.

## Usage

Point your parser root at any project folder under `examples/projects/*`.

Example:

- `examples/projects/02-type-only-imports`
- `examples/projects/06-dynamic-import`
- `examples/projects/11-path-aliases`
