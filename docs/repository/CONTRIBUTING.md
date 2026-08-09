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
   - Run `npm run verify`; firmware changes must also pass
     `platformio test --project-dir hardware -e native` and
     `platformio run --project-dir hardware -e esp32dev`. Rule changes must run the Firebase
     emulator suite in a Java-enabled environment.
   - Update the HLD/LLD, Firebase data dictionary, API, hardware and test docs
     whenever their contracts change. Do not leave behavior documented only in
     a PR description.

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
- Record real bench/route evidence for timing, GNSS, TLS, power, reconnect and
  watchdog changes. A successful compile is not a physical acceptance test.
- Never enable insecure TLS, commit `secrets.h`, or automate irreversible
  Secure Boot/flash-encryption eFuses without an approved provisioning plan.
