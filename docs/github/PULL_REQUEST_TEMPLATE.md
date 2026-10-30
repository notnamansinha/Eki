## Summary

<!-- What changed and why. Write the pull request title as a Conventional Commit subject, for example "fix(trip): credit a revisited stop after a GNSS gap". -->

Fixes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change to an API, data model, rule, firmware schema or configuration
- [ ] Documentation only

## How to verify

<!-- Steps a reviewer can follow to confirm the change works. -->

## Checks run

- [ ] `npm run verify`
- [ ] `npm run test:rules` (rules, or backend code covered by the emulator suites)
- [ ] `npm run test:e2e:admin` (admin, sign-in or feedback screens)
- [ ] Passenger Playwright suites (`playwright.passenger-layout.config.ts`, `playwright.passenger-progress.config.ts`)
- [ ] `npm run qa:budget` with a mapped test (critical source files)
- [ ] `platformio test --project-dir hardware -e native` and the affected firmware build
- [ ] `npm run docs:sync`, `npm run docs:check` and `git diff --check` (documentation)
- [ ] Recorded hardware run (claims about timing, power, GNSS, TLS or radio)

Checks not run, and why:

## Checklist

- [ ] Documents that describe the changed behaviour are updated in this pull request.
- [ ] Tracked templates (`backend/.env.example`, `frontend/env.production.example`, `hardware/include/secrets.example.h`), rules and indexes are updated where their contract changed.
- [ ] Examples, logs and screenshots contain placeholders only: no credentials, tokens, personal data, private hostnames or location traces.
