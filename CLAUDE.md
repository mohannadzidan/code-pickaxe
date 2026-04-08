# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- **Hard Rules**
- Use TypeScript for all code changes across apps and shared packages.
- Keep dependency flow one-way: components -> orchestrators -> stores -> services -> shared types/utils.
- Never invert layer direction (lower layers must not import higher layers).
- Keep components presentational and event-forwarding; do not place business workflows in components.
- Keep stores domain-focused and React-free; stores must not import other stores.
- Put cross-domain coordination in orchestrators, not in stores or component effects.
- Keep side effects in services; stores should transition state, not own external API/library mutation logic.
- Use named selectors as the read API for state access; avoid broad subscriptions.
- Use explicit domain action names (business operations), not generic setter patterns as public API.
- Keep shared contracts and utility functions framework-agnostic.
- Preserve backward-compatible public module APIs unless a breaking change is explicitly requested.
- Favor minimal, localized changes over broad rewrites.

- **Implementation Strategy Guardrails**
- Prefer incremental refactors that keep the app runnable after each step.
- When introducing new behavior, start from domain model and contracts, then add store actions, orchestrators, services, and finally UI wiring.
- For new features, define clear domain boundaries first; avoid creating cross-domain coupling by convenience.
- If behavior spans domains, create or extend an orchestrator instead of adding subscriptions/effects between domains.
- If logic requires IO, external libraries, or async coordination, extract it into a service before wiring UI.
- Keep derived data out of persisted state unless computation cost justifies memoized selectors.
- Reuse existing architectural primitives before introducing new patterns.
- Add types first for new state/events/payloads to make impossible states unrepresentable.

- **Project Structure Guardrails**
- Organize by domain/feature, not by UI screen.
- Keep each domain’s store/actions/selectors near each other.
- Place cross-feature workflows under an orchestrators layer.
- Place shared infra and contracts under shared modules only when genuinely cross-domain.
- Keep bootstrap/composition in a single app entry layer that wires service singletons and adapters.
- Treat parser/analysis engine as backend domain logic; UI should consume API contracts, not backend internals.

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
