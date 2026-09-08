# Eki — AI Agents

> **Multi-agent context** — This file is the canonical project context for **Cline**, **Aider**, **OpenCode**, **Codex CLI**, and other AGENTS.md-native tools. Claude Code and Cursor read it via the `CLAUDE.md` copy.

Read CONVENTIONS.md before any GitHub or git operation.

<!-- BEGIN bigpowers:context-routing -->
## Context Routing

This monorepo has no sub-AGENTS.md files yet.
Read the per-area guides under `docs/` before editing a workspace.

| Glob | Where the area rules live |
|------|---------------------------|
| `backend/**` | `docs/backend/` and `backend/package.json` |
| `frontend/**` | `docs/frontend/` and `frontend/package.json` |
| `hardware/**` | `docs/hardware/` and `hardware/include/secrets.example.h` |
| `scripts/**` | `scripts/*.test.mjs` and `docs/repository/` |
| `docs/**` | `docs/index/` and `docs/repository/` |
<!-- END bigpowers:context-routing -->

<!-- BEGIN bigpowers:learned-preferences -->
## Learned User Preferences

- (none yet — updated via `session-state`)

## Workspace Facts

- (none yet — durable facts discovered across sessions)
<!-- END bigpowers:learned-preferences -->

<!-- BEGIN bigpowers:project -->
## Project

Eki tracks campus shuttle buses in real time.
ESP32 GNSS units stream authenticated HTTPS telemetry to an Express backend.
A Next.js panel shows live positions to passengers and operators.

Stack: TypeScript / Next.js 16 + Express 5 / Node 24 / ESP32-C firmware (PlatformIO, C) / Firebase (Firestore, Rules, Hosting).

## Commands

| Action | Command |
|--------|---------|
| Run (dev) | `npm run dev` (concurrently starts both workspaces) |
| Test | `npm test` — requires `FIREBASE_DATABASE_URL`; CI value `https://eki-unit-test-default-rtdb.firebaseio.com` |
| Rules tests | `npm run test:rules` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Preflight | `npm run verify` (= lint + test + build + `npm audit --omit=dev --omit=optional`) |
| CI | `gh pr checks` — full CI also runs `npm run build:production` and PlatformIO firmware jobs (`.github/workflows/ci.yml`) |

## Test

`npm test` or N/A

## Lint

`npm run lint` or N/A

## Build

`npm run build` or N/A

## Architecture

This is an npm workspaces monorepo.
`frontend/` is a Next.js App Router panel for passengers and admins.
`backend/` is an Express 5 + Firebase Admin API.
Firestore holds ordered trip and telemetry state.
Firebase Hosting serves the panel.
Firebase Rules gate client reads.
`hardware/` holds ESP32-C firmware.
The firmware posts signed GNSS pings to backend telemetry endpoints.
`scripts/` holds build, CSP, and service-worker tooling.

## Conventions

- Keep backend layering: `src/routes` → `src/middleware` → `src/lib`.
- Match the module style of the workspace you extend.
- Validate environment variables at boot. Fail closed when a variable is missing.
- Wrap third-party libraries behind thin project-owned interfaces (see `backend/src/lib/googleMaps.ts`).
- Use vitest (`vitest run`) for new tests in both workspaces.
- Never edit committed `firestore.rules` during emulator tests. The harness copies rules to a temp dir.
- Write specs/ plans before feature code. Evidence beats claims.

## Never

- Never dismiss reproducible gate failures as pre-existing or out of scope.
- Never proceed on red Preflight or red CI — invoke quick-fix or fix-bug first.
- Never commit real Firebase, Google Maps, or ngrok secrets. CI uses `ci-only-placeholder` values; real secrets live in the Deploy workflow.
- Never store the ngrok authtoken in this repository.
- Never put the tunnel URL in `backend/.env`. Configure it in `frontend/.env.*` and `hardware/include/secrets.h`.
- Never commit `hardware/include/secrets.h` or `hardware/keys/`. Commit only `secrets.example.h`.

## Agent Rules

- **Workflow Mandate:** Use bigpowers skills (e.g. `plan-work`, `develop-tdd`) for structured work.
- **Always Green:** Preflight and CI must be green before forward work.
- Read specs/ and CONVENTIONS.md before writing code.
- Write the minimum code that solves the stated problem.
- Run tests after every change. Show evidence before declaring done.
- All planning output goes in specs/.
- End every story with a step-by-step manual verification script. Wait for user UAT confirmation before marking a story done.
- One clarifying question beats a wrong assumption baked into code.

## Token Economy — Minimal Footprint

> Production-safe subset of the 8-rule AGENTS.md pattern (Vercel engineer, ~60B tokens).
> Rule 1 ("no backward compatibility") is excluded deliberately: it risks data loss in production.

1. **Check existing dependencies first.** DO inspect what your current dependencies already do before adding a package or writing your own code.
2. **Prefer mature, maintained libraries.** DO NOT rewrite a capability a maintained library provides without a documented reason.
3. **Copy validated patterns.** DO study how established products solve the same problem before inventing a new approach.
4. **Keep the simplest working implementation.** DO write the least code that satisfies the stated requirement. NEVER add preventive abstraction or unused config layers.
<!-- END bigpowers:project -->
