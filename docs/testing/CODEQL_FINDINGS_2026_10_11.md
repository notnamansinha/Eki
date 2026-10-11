# First CodeQL findings review

Reviewed the seven open findings produced by PR #297 at `fcf2507`. A successful
analysis job means the scan ran; it does not mean there were no findings.

| Alert | Review and action |
| --- | --- |
| #1 `js/bad-tag-filter`, CSP generation | Replaced the script-tag regular expression with parse5 HTML parsing. Regression cases cover closing-tag whitespace, quoted `>`, uppercase external attributes, comments/inert templates, browser newline normalization and duplicate/empty bodies. This operates on the trusted static export, not arbitrary uploaded HTML. |
| #2 `js/incomplete-url-substring-sanitization`, polyline test | The substring was selecting mock calls for assertions, not validating a security boundary. Changed it to the exact Google Routes API origin to remove ambiguity. |
| #3 `js/insecure-temporary-file`, research catalog | Removed the predictable shared temporary-directory default from all three research tools. They require an explicit operator-owned `EKI_QA_RESEARCH_DIR`; snapshot creation requests owner-only permissions on systems that support them. No historical research or application data was deleted. |
| #4 `js/remote-property-injection`, fleet mirror | Existing computed object-literal keys already create own data properties, and bus IDs are validated. Use `Object.fromEntries` consistently for both mirror levels, including prototype-like IDs, so this safe construction is explicit. No permission scope changes. |
| #5 `js/remote-property-injection`, settings | Existing request-key allowlisting rejected unknown/prototype keys. Destination keys now come only from the static server schema, with boolean handling explicit; request keys never choose the assignment destination. Validation and partial-update semantics remain. |
| #6 `js/file-access-to-http`, API integration test | False positive: deliberately installs the public repository RTDB rules into the isolated `eki-r20-test` emulator. Both emulator hosts must be loopback before this request; this is not an application HTTP handler or a secret-file disclosure. |
| #7 `js/http-to-file-access`, telemetry benchmark | False positive: an operator-invoked staging benchmark writes its JSON measurements and before/after administrative health snapshots to the operator-selected report path. The response cannot select that path, and the JSON is not executed. URL/credentials/staging confirmation are validated before measurement. |

The two intentional test/report flows are dismissed with their specific review
reasons. The other five findings are resolved by the source changes above; final
head scanning determines their current status. These scans do not certify live
Firebase policy, credentials, physical TLS/OTA or release acceptance.
