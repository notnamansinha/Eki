# Next Lint Directory Matching Adapter

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-012 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`@eki/next-lint-glob` replaces `fast-glob` for the Next.js ESLint plugin (`@next/eslint-plugin-next`). The plugin uses `fast-glob` only for `globSync(rootDir, { onlyDirectories: true })`, and `fast-glob` brought in the unpatched `braces` recursion advisory through `micromatch` [1]. The adapter removes that dependency from the repository instead of waiting for an upstream patch (issue #234).

## 2. How it is wired

- The root `package.json` has the development dependency `"fast-glob": "file:tools/next-lint-glob"` and the override `"@next/eslint-plugin-next": { "fast-glob": "$fast-glob" }`. Only the Next lint plugin receives the adapter; no global `fast-glob` override applies to other packages.
- `index.cjs` exports `globSync` only, backed by `tinyglobby` pinned at `0.2.17`.
- The frontend keeps its normal `next` and `eslint-config-next` versions.

## 3. Behaviour

The adapter sets `expandDirectories: false` [2], so a directory pattern matches the directory itself, as `fast-glob` does. It returns absolute results for absolute patterns. For an absolute pattern it resolves the existing, non-glob prefix with `realpathSync.native`, so Windows DOS aliases and junctions match the paths the crawler reports. A missing root keeps the normal empty result.

`scripts/next-lint-root-resolution.test.mjs` runs the plugin's real `getRootDirs` helper through the adapter with string and array roots, brace and wildcard patterns, a missing directory and a root outside the working directory. `npm test` runs it.

## 4. Maintenance

Recheck the adapter when upgrading the Next lint plugin or when another package starts importing `fast-glob`; only `globSync` is implemented. The CI `npm audit` steps confirm that the advisory stays absent.

## 5. References

[1] GitHub, "GHSA-vfj7-8cjw-p6xm," GitHub Advisory Database, https://github.com/advisories/GHSA-vfj7-8cjw-p6xm.

[2] tinyglobby, "Options: expandDirectories," https://superchupu.dev/tinyglobby/options#expanddirectories.
