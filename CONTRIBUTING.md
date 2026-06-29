# Contributing to Eki

We welcome contributions to the Eki ecosystem. This document outlines the
standard procedures for contributing code, reporting issues, and proposing
new features.

## Development Workflow

1. **Branching Strategy**
   - `main`: Production-ready code. Always deployable.
   - `feat/<feature-name>`: For new features (e.g., `feat/admin-analytics`).
   - `fix/<bug-name>`: For bug fixes (e.g., `fix/socket-timeout`).
   - `chore/<task>`: For maintenance tasks (e.g., `chore/deps-update`).

2. **Commit Conventions**
   We follow Conventional Commits. Your commit messages must be structured as
   follows:
   - `feat: add passenger request queue`
   - `fix: resolve memory leak in trackingGateway`
   - `docs: update hardware flashing instructions`
   - `refactor: extract eta computation logic`

3. **Pull Request Process**
   - Ensure your code passes all linting (`npm run lint`).
   - Ensure the build succeeds (`npm run build`).
   - Provide a clear PR description detailing *why* the change was made,
     not just *what* was changed.
   - If the PR changes UI, include screenshots.
   - Require at least one approving review from a core maintainer before merging.

## Local Environment

- Never commit `.env` or `.env.local` files.
- If your PR introduces a new environment variable, you must update
  `.env.example` and the respective `README.md` file immediately.

## Hardware Contributions

If you are contributing to the `hardware/` (ESP32) firmware:

- Test your changes on physical hardware before opening a PR.
- Ensure that the Smart Transmission thresholds (`DISTANCE_THRESHOLD_M`, etc.)
  are not arbitrarily changed without real-world validation to prevent
  database write spikes.
