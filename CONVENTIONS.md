# Eki — Project Conventions

These conventions bind all AI agents and contributors.
Follow them on every task.
CLAUDE.md and AGENTS.md carry the same rules for agents.

## Conventional Commits & Semantic Versioning

All commits MUST follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
Versioning MUST follow [Semantic Versioning 2.0.0](https://semver.org/).

### Commit Message Format

| Part | Rule |
|------|------|
| Format | `<type>(<scope>): <description>` |
| Space | A space after the colon is MANDATORY |

### Types & Version Bumps

| Commit type | Version bump | Example scope |
|-------------|--------------|---------------|
| `feat` | Minor (x.Y.z) | `feat(backend): add trip cancel endpoint` |
| `fix` | Patch (x.y.Z) | `fix(frontend): restore map on reconnect` |
| `perf` | Patch (x.y.Z) | `perf(backend): reuse Firestore batch` |
| `docs`, `chore`, `style`, `refactor`, `test` | None (unless breaking) | `test(hardware): cover GNSS parse edge cases` |
| `BREAKING CHANGE:` or `!` | Major (X.y.z) | `feat(backend)!: drop v1 telemetry contract` |

## Git & GitHub Operations

- Never work directly on `main` or `master`.
- Every task MUST start on a feature branch or worktree. Use `kickoff-branch`.
- This project runs in `solo-git` mode. See `specs/state.yaml` → `workflow_mode`.
- Merge only after Preflight and CI pass.
- Never push directly to `main`. Push feature branches only.
- Never call the GitHub REST API directly.
- Never create GitHub issues from automated workflows. Write local specs/ files instead.
- NEVER add AI attribution footers to commits. No `Co-authored-by` or equivalent.
- Verify remote auth with `gh auth status` before remote operations.

### Pre-Merge Verification Gates

Run local gates before merging any branch:

| Gate | Command | When |
|------|---------|------|
| Preflight | `npm run verify` | Every merge |
| Rules | `npm run test:rules` | When `firestore.rules` changed |
| Production build | `npm run build:production` | When env or CSP handling changed |

## Agent Workflow Mandates

**AGENTS MUST NEVER BYPASS THE BIGPOWERS WORKFLOW.**

- **No Direct Coding:** A request like "build feature X" MUST NOT be answered with direct code.
- **Required Skills:** Route all work through bigpowers skills.
- Start with `survey-context` when you lack context.
- Use `plan-work` to flesh out tasks before writing feature code.
- Use `develop-tdd` to implement a plan.
- Use `investigate-bug` for bug reports before writing a fix.
- **Verification Mandate:** Code generation without a specs/ plan is forbidden.
- Every story MUST end with a step-by-step manual verification script.
- Wait for user UAT confirmation before a story is done.

## Always Green / Shift Left

Always Green means Preflight and CI are green before forward work.
Green is not "green enough for this task".

**Shift Left (1-10-100):** A defect costs 1x to fix in development.
It costs 10x to fix in integration.
It costs 100x to fix in production.
Fix a red gate now. Shipping a defect later costs more.

| Term | Definition |
|------|------------|
| Preflight | The full local verification chain recorded in CLAUDE.md. Preflight MUST pass before kickoff, develop, or verify phases advance. |
| CI green | `.github/workflows/ci.yml` MUST pass before merge or land. |

**Existing-project note:** this doctrine applies from seed time onward.
Re-run `seed-conventions` to refresh it after a merge.

## Discovered Defects

Any reproducible gate failure is a discovered defect.
It is not optional background noise.

**fix-or-log ladder (mandatory):**

1. **quick-fix** — trivial, data-only, or single-file fixes inside guardrails.
2. **fix-bug** — when quick-fix guardrails abort or the failure needs investigation. Write `specs/bugs/BUG-*.md` and use TDD.
3. **Log** — only when reproduction is blocked after a good-faith attempt. Write a BUG spec and stop forward work until triage.

Discovered fixes ship in the same PR as the original work.
They ship in separate Conventional Commits.
Never narrate a failure and continue.

**Hard block:** red Preflight or red CI blocks progress until fix-or-log yields green.

### Banned dismissive phrases

Agents MUST NOT use these phrases to ignore reproducible failures:

| Banned phrase | Required behavior instead |
|---------------|---------------------------|
| Pre-existing / pre-existing issues | Run fix-or-log; prove unrelated with a passing repro after revert |
| unrelated to this session | Session boundaries do not waive green gates |
| not introduced by my changes | Bisect or fix anyway; the solo owner owns the whole tree |
| out of scope (ignoring a red gate) | Invoke quick-fix or fix-bug; scope never overrides Always Green |

## specs/ — All Planning Output Goes Here

Every skill writes its output to `specs/` at the project root.

### YAML cockpit (runtime + delivery)

| Layer | File | Answers |
|-------|------|---------|
| Session | `specs/state.yaml` | Active flow, epic, handoff, workflow mode |
| Release index | `specs/release-plan.yaml` | Version intent, WSJF epic list |
| Progress | `specs/execution-status.yaml` | Flat status keys, the sole source of truth for story state |
| Planning UI | `specs/planning-status.yaml` | Discover-phase checklist (optional) |

| Rule | Statement |
|------|-----------|
| Ownership | Do NOT put story status in `release-plan.yaml`. |
| Duplication | Do NOT duplicate the release plan inside `state.yaml`. |
| Mode | `state.yaml` → `workflow_mode` is the canonical integrate signal. |
| Handoff | Critical-path skills write `handoff.next_skill` as their last action. |

### Intent vs delivery vs execution

| Question | File | Format |
|----------|------|--------|
| What should the product do? | `specs/product/SCOPE_LATEST.yaml` | YAML |
| North star / initiative | `specs/product/VISION_LATEST.yaml` | YAML |
| Glossary | `specs/product/GLOSSARY_LATEST.yaml` | YAML |
| What ships in this release? | `specs/release-plan.yaml` | YAML |
| How to implement a story? | `specs/epics/eNN-*.yaml` | YAML + MD |
| Where are we in the session? | `specs/state.yaml` | YAML |

## Code Style

- Functions: 4–20 lines. Split longer functions.
- Files: under 300 lines. Split by responsibility.
- One thing per function. One responsibility per module (SRP).
- Names: specific and unique. Avoid `data`, `handler`, `Manager`.
- Types: explicit. No `any`. No untyped public functions.
- No code duplication. Extract shared logic into a module.
- Early returns over nested ifs. Max 2 levels of indentation.
- Prefer positive conditionals over negative flags.
- The Stepdown Rule: functions descend one level of abstraction per line.
- Names describe side-effects. A sender is `sendWelcomeEmail`, not `processUser`.
- No magic strings or numbers. Extract literals to named constants.
- Extract complex boolean logic into named predicates.
- Prefer exceptions over error codes.
- Delete dead code. Never comment it out.
- Boy Scout Rule: leave touched files cleaner than you found them.
- Law of Demeter: call only your immediate collaborators.
- Exception messages name the offending value and the fix.
- Favor interfaces over concrete types when injecting dependencies.
- Use `[0-9]` in `grep -E`. Never use `\d`; GNU grep treats it as a literal.

## Comments

- Keep your own comments. Never strip them on refactor.
- Write WHY, not WHAT.
- Reference issue numbers or commit SHAs when a line exists for a bug.
- No obvious comments that restate the code.
- No commented-out code. Delete it. Recover it from git history.

## Tests (F.I.S.T.)

Tests are **F**ast, **I**ndependent, **R**epeatable, **S**elf-Validating, **T**imely.
Tests run headless with one command.
Every new function gets a test.
Every bug fix gets a regression test.
Never skip a test without an explicit ambiguity note.
Cover boundary conditions: empty input, maximum, minimum, off-by-one.
Test through public interfaces only.
Assert on observable outcomes, not internal state.
Name fake classes for external I/O instead of inline stubs.

## Dependencies

- Inject dependencies through constructor or parameter. Never import globals.
- Wrap third-party libraries behind thin project-owned interfaces.

## Structure

- Follow the framework convention: Next.js App Router, Express 5, PlatformIO.
- Predictable paths: `routes/`, `middleware/`, `lib/`, `components/`.
- Prefer small focused modules over god files.

## Formatting

- Use the language default formatter. Prettier handles TypeScript and CSS.
- Configure formatting in pre-commit and on-save.
- No style debates beyond that.

## Logging

- Use structured JSON for backend and script logs.
- Use plain text only for user-facing CLI output.
- Never log secrets, tokens, or auth headers.

## Defensive Code

Implement defensive code ONLY for the categories listed here.

| Category | Mandate |
|----------|---------|
| Rate limiting | Keep rate limits on every public endpoint. Never remove a limit silently. Preserve the sharded identity approach in `backend/src/lib/rateLimitShard.ts`. |
| Retry with backoff | Retry transient network failures with exponential backoff. Preserve ordered trip state. Feed failures to `backgroundFailureTracker`. |
| Timeout guards | Set explicit timeouts on handlers and upstream HTTP calls. Abort on deadline (see `ROUTE_GEOMETRY_TIMEOUT_MS`). |
| Graceful degradation | Keep the panel and firmware working when backend or tunnel is down. Serve the degraded `/health` 503 contract when dependencies are unreachable. |

## Stack Conventions — Node Service

Profile: `node-service`.

### Architecture

- Layer the backend: routes → middleware → services → lib helpers.

### Conventions

- Match the existing `package.json` module system in each workspace.
- Validate `process.env` at boot. Fail closed on a missing variable.
- Keep integration tests headless. Use vitest in both workspaces.
- Emit structured JSON logs from `backend/` and `scripts/`.

### Never

- Never log secrets or full auth tokens.
- Never use `any` on public API types.

## File-Size Exceptions

Files over 300 lines require a documented exception.
Add any exception here with rationale and a review date.

| File | Lines | Rationale | Review date |
|------|-------|-----------|-------------|
| (none yet) | — | — | — |
