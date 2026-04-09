# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.



- **Authority Links**
- Primary project intent and user-facing workflow: [README.md](README.md).

- **Key Workflow Commands**
- Install dependencies: `pnpm install`.
- Run full workspace in dev: `pnpm dev`.
- Build full workspace: `pnpm build`.
- Lint from root (Oxlint): `pnpm lint`.
- Format: `pnpm fmt`.
- Build only web app: `pnpm --filter @repo/web build`.
- Build only API app: `pnpm --filter @repo/api build`.
- Run API in dev watch mode: `pnpm --filter @repo/api dev`.
- Run built backend from root: `pnpm start:backend`.
- Test command status: no dedicated test script is currently defined at root/web/api package level.
- Single-test command status: not available until a test runner is added.

- **Big-Picture Architecture (for fast onboarding)**
- Monorepo with Turbo + pnpm workspaces.
- Backend (`apps/api`) exposes typed procedures and domain analysis pipeline.
- Frontend (`apps/web`) consumes typed API contracts and renders domain state through React + Zustand.
- Domain workflows are composed through orchestrators; shared side effects are encapsulated in services.
- Application composition lives in bootstrap/container modules that wire long-lived service instances.

