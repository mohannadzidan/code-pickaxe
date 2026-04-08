<div align="center">

<img src="./apps/web/public/icon.svg" width="144"/>

  <h1 align="center">Code Pickaxe</h1>

  <p align="center">
    <strong>Code Pickaxe is a code analysis tool that turns your codebase into an interactive visual graph.</strong>
  </p>

![GitHub package.json version (branch)](https://img.shields.io/github/package-json/v/mohannadzidan/code-pickaxe/main?label=version&link=https%3A%2F%2Fgithub.com%2Fmohannadzidan%2Fcode-pickaxe)


</div>


Code Pickaxe is a code analysis tool that turns your codebase into an interactive visual graph.

Instead of reading files one by one, you can explore modules, classes, functions, and their dependencies as connected nodes—making architecture easier to understand for humans.

## Why use it?

- Understand unfamiliar codebases faster.
- See how modules and symbols depend on each other.
- Spot central files and hidden coupling.
- Navigate from graph relationships directly to source code.
- Make onboarding, refactoring, and architecture reviews more engaging.

## What you can do

- Parse a TypeScript/TSX codebase into a dependency graph.
- Explore entities (modules, classes, functions, methods, properties, etc.).
- Expand/collapse parts of the graph to control complexity.
- Hide noisy branches to focus on what matters.
- Use force-based layout + reheat to improve readability.
- Open source code in the integrated code pane and jump to usage locations.

## Quick start

### 1) Install dependencies

```bash
pnpm install
```

### 2) Create web env file

Use your shell of choice to copy:

```bash
cp ./apps/web/.env.example ./apps/web/.env
```

PowerShell alternative:

```powershell
Copy-Item .\apps\web\.env.example .\apps\web\.env
```

### 3) Run in development

```bash
pnpm dev
```

This starts the monorepo apps (web + API) through Turbo.

## Typical workflow

1. Start the app and wait for parsing to finish.
2. Click nodes to inspect related source in the code pane.
3. Right-click nodes to explode, collapse, or hide parts of the graph.
4. Switch vertical/horizontal layout depending on the shape of your code.
5. Hit **Reheat** when you want the force simulation to relax the graph again.
6. Click edge labels to jump to concrete usage locations.

## Monorepo structure

- `apps/web` — React + Vite frontend (graph UI + code pane)
- `apps/api` — Express + tRPC backend (parser + graph API)
- `packages/typescript-config` — shared TS config

## Scripts

From repository root:

- `pnpm dev` — run development mode
- `pnpm build` — build all workspace targets
- `pnpm test` — run unit tests across workspace apps
- `pnpm test:watch` — run unit tests in watch mode
- `pnpm start:backend` — start built backend server
- `pnpm lint` — run linter

## Requirements

- Node.js `>= 18`
- `pnpm` (workspace uses `pnpm@8.x`)

## Notes

- The parser currently targets a local source folder configured in the API router.
- If you want to analyze a different project path, adjust the parsing target in the API app.

---

If your codebase feels too big to hold in your head, Code Pickaxe gives you a map.
