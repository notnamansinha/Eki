# Eki Documentation Standard

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-GEN-003 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This standard defines how Eki documents are structured, identified, written and verified. It applies to every Markdown file tracked in the repository. Contributors and automated agents shall follow it when they add or change documentation.

## 2. Normative references

The structure of each document class is adapted from the following standards. Eki uses their section organisation, not their full content requirements.

| Ref. | Standard | Used for |
|---|---|---|
| [1] | ISO/IEC/IEEE 29148:2018, Requirements engineering | Software requirements specification |
| [2] | IEEE 1016-2009, Software Design Descriptions | High-level and low-level design |
| [3] | ISO/IEC/IEEE 42010:2022, Architecture description | Architecture views and decisions |
| [4] | ISO/IEC/IEEE 26514:2022, Design and development of information for users | Procedures and user guides |
| [5] | ISO/IEC/IEEE 29119-3:2021, Test documentation | Test strategy and evidence records |
| [6] | M. Nygard, "Documenting Architecture Decisions," 2011 | Decision records |
| [7] | Diataxis documentation framework, https://diataxis.fr | Separation of tutorial, how-to, reference and explanation content |

The key words "shall", "should" and "may" carry their normative meaning: "shall" is mandatory, "should" is recommended, "may" is optional.

## 3. Document control

### 3.1 Control block

Every controlled document shall begin with a level-1 title followed directly by this single-row table:

```markdown
# <Title in title case>

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ARC-001 | 1.0 | Current | 2026-10-30 |
```

| Field | Rule |
|---|---|
| Document ID | `EKI-<AREA>-<NNN>`, unique, never reused. The area codes are listed in Section 3.2. |
| Version | `<major>.<minor>`. Increment the minor number for corrections and the major number when the described behaviour changes. |
| Status | One of `Current`, `Proposed`, `Historical` or `Superseded`. See Section 3.3. |
| Last updated | ISO 8601 date (`YYYY-MM-DD`) in India Standard Time (UTC+05:30). |

Revision history is kept in Git. Documents shall not contain change logs.

### 3.2 Area codes

| Code | Area | Location |
|---|---|---|
| GEN | General, onboarding and repository policy | `docs/`, repository root |
| REQ | Requirements | `docs/requirements/` |
| ARC | Architecture and design | `docs/design/` |
| ADR | Architecture decision records | `docs/design/*_DECISION.md` |
| API | Interface specifications | `docs/api/`, `backend/API*.md` |
| DAT | Data model and storage | `docs/data/` |
| UIX | User interface and design system | `docs/design/UI_DESIGN_SYSTEM.md` |
| SEC | Security | `docs/security/`, `SECURITY.md` |
| CST | Cost, quotas and capacity | `docs/cost/` |
| OPS | Operations, deployment and runbooks | `docs/operations/` |
| HW | Hardware and firmware | `docs/hardware/`, `hardware/` |
| PKG | Package and test-suite guides | `backend/`, `frontend/`, `e2e/`, `tools/` README files |
| TST | Test strategy and QA programme | `docs/testing/`, `qa/` |
| EVD | Dated test and audit evidence | `docs/testing/`, `qa/` |

The complete register of document IDs is maintained in the [documentation index](README.md#4-document-register).

### 3.3 Status values

| Status | Meaning | Maintenance rule |
|---|---|---|
| Current | Describes the software at the head of the documented branch. | Update in the same change as the behaviour it describes. |
| Proposed | Describes a plan or decision that is not yet implemented. | State the gate that would make it current. |
| Historical | Records a dated run, audit or measurement. | Do not edit the body. Corrections are made in a newer document that links back. |
| Superseded | Replaced by another document. | Link to the replacement in the first paragraph. |

### 3.4 Uncontrolled files

The following files carry no control block because tools parse or render them in a fixed format:

- GitHub issue and pull request templates in `.github/`.
- Agent instruction files: `frontend/AGENTS.md`, `frontend/CLAUDE.md`, `docs/testing/EKI_Antigravity_Webapp_Testing_Skill.md` and everything under `docs/testing/skills/`.
- The machine-parsed acceptance plan and ledger: `docs/testing/WEBAPP_A_Z_AB_TESTING_PLAN.md` and `docs/testing/WEBAPP_A_Z_AB_TESTING.md`.
- Generated mirrors (Section 7).

## 4. Document classes and required structure

Section headings in controlled documents shall be numbered (`## 1. Purpose`, `### 1.1 Scope`). Choose the class that matches the reader's task and use its sections in order. A section that does not apply may be omitted; do not add empty sections.

| Class | Reader's task | Required sections |
|---|---|---|
| Specification | Know what the system shall do | Introduction (purpose, scope, definitions, references); overall description; specific requirements with IDs; verification and traceability |
| Design description | Understand how the system is built | Introduction; context; design views (logical, process, data, deployment as relevant); design rationale; constraints and risks; references |
| Decision record | Understand why one option was chosen | Context; decision; status; consequences; alternatives considered; evidence |
| Interface specification | Call or implement an interface | Introduction; conventions (authentication, errors, versioning); operations; limits; references |
| Reference | Look up a value | Purpose; tables grouped by topic; references |
| Procedure | Complete a task | Purpose; prerequisites; numbered steps, each with the expected result; verification; recovery or troubleshooting |
| Cost model | Estimate or control spend | Purpose and scope; pricing basis with sources and retrieval date; usage model; scenarios; quotas and limits; cost controls; assumptions; references |
| Evidence record | Audit a past result | Original body, unchanged, under a `Historical` control block |

## 5. Writing rules

### 5.1 Language

1. Write for a reader who arrives with no knowledge of previous conversations or pull requests. Describe what the system does now, not how it came to be.
2. Use plain English, active voice and the present tense. Name the actor: "the backend rejects the request", not "the request is rejected".
3. Use one name per concept. Terms are defined in the [glossary](GLOSSARY.md). Do not alternate synonyms for variety.
4. Every sentence shall change what the reader knows or does. Remove reassurance, praise of the design, rhetorical questions and closing summaries that repeat the body.
5. Do not use emojis, decorative symbols, exclamation marks or marketing language.
6. Do not use em dashes or en dashes. Use a colon, a comma, parentheses or a new sentence. Write ranges as `10 to 30 s` or `R01-R15`.
7. Avoid filler and inflated vocabulary. Prohibited examples: `delve`, `seamless`, `cutting-edge`, `leverage` (as a verb), `robust` (as praise), `utilize`, `in order to`, `it is important to note`, `comprehensive` (as praise).
8. Headings use sentence case after the number, except the document title, which uses title case.

### 5.2 Facts, numbers and units

1. Every file path, command, flag, environment variable, collection name, endpoint and threshold shall be verified against the source before it is written. Link to the source file when a value is likely to change.
2. Use SI units with a space: `15 m`, `12 s`, `250 ms`, `3.3 V`. Use ISO 8601 dates.
3. Prices shall state the currency, the unit, the source and the retrieval date.
4. Mark estimates as estimates and state the assumptions they depend on.
5. Write identifiers, paths, commands and literal values in backticks.

### 5.3 Tables, figures and code

1. Use tables for comparisons, configuration values and requirement lists.
2. Diagrams shall be Mermaid code blocks so that they are versioned with the text. Caption each diagram with a line immediately below it: `Figure 2. Telemetry path from receiver to browser.` Describe the essential content of the figure in the surrounding text.
3. Command examples shall be runnable as written from the stated working directory. Use placeholders such as `<project-id>` for values the reader supplies. Never include real credentials, tokens, device secrets or personal location data.

### 5.4 Links

1. Use relative links between repository files. Every link and heading anchor shall resolve.
2. Link to the authoritative document instead of repeating its content. Repeat a value only when the reader needs it at that point, and link to its source.

### 5.5 References

List external sources in a numbered References section in IEEE style:

```text
[1] Google, "Firebase pricing," firebase.google.com/pricing. Accessed: 2026-10-30.
```

## 6. Evidence records

1. Evidence records keep their original body, measurements, commits and dates. They are not rewritten to match later code.
2. A correction or a newer result is recorded in a new document or in the [testing index](testing/README.md), which links to the original.
3. Evidence shall not contain credentials, raw personal location traces or unredacted device identifiers. Store such material in approved private storage.

## 7. Mirrors

Markdown files outside `docs/` are mirrored into `docs/` so that the folder holds the complete documentation set.

| Source | Mirror |
|---|---|
| Root file, for example `README.md` | `docs/repository/README.md` |
| `.github/<path>` | `docs/github/<path>` |
| `<package>/<path>`, for example `backend/API.md` | `docs/<package>/<path>` |

Edit the source, never the mirror. Then run `npm run docs:sync`. The test `backend/src/docsMirror.test.ts` fails if a mirror differs from its source.

## 8. Verification

Run these checks from the repository root before opening a pull request that changes documentation:

```powershell
npm run docs:sync
npm run docs:check
git diff --check
```

`npm run docs:check` runs the documentation mirror test, the configuration coverage test and the documentation quality test. The quality test checks control blocks, unique document IDs, the document register, emojis, dashes, prohibited phrases and every relative link and anchor.

A reviewer shall also confirm, for each changed statement, that the code, configuration or recorded evidence supports it.
