# PR 188 temporary testing assets and cleanup

**Scope:** PR [#188](https://github.com/notnamansinha/Eki/pull/188), the live
ESP32/backend test setup documented in the repository, and temporary resources
created outside GitHub. This is a cleanup register, not a production deployment
guide.

**Disposition:** Keep the test assets only for the current validation window.
After the tests are complete, remove the resources below unless the team
explicitly adopts the corresponding observability or hosting component for
ongoing operations. PR #188 adds application telemetry and its local test
stack; merging it does not provision or own any external Grafana or ngrok
resources.

## Cleanup register

| Temporary asset | Where it lives | End-of-test action |
| --- | --- | --- |
| Backend ngrok agent endpoint | Outside the repository; forwards the public test hostname to local backend port `4000`. The current steps are in the root [README](../../README.md) and [ngrok runbook](NGROK_TUNNEL.md). | Stop the agent. If the hostname is a reserved endpoint created only for this test, remove it from the ngrok account after confirming no other test or device uses it. Do not publish the hostname or auth token in this file. |
| Optional frontend ngrok agent endpoint | Outside the repository; forwards a public test hostname to local frontend port `3000`. The root [README](../../README.md) describes the optional path. | Stop the agent and remove a test-only reserved endpoint after confirming it is unused. |
| Local backend/frontend dev servers | Developer workstation; typically backend `localhost:4000` and frontend `localhost:3000`. | Stop the processes. These are not managed by PR merge or CI. |
| Test endpoint configuration | Ignored local env files and/or `hardware/include/secrets.h`; the ESP32 endpoint and trust root are compiled into firmware as described in [hardware setup](../../hardware/README.md). | Remove local test values when no longer needed. Before replacing ngrok with a managed API hostname, update the device endpoint/trust configuration and rebuild/reflash the test device. Do not commit local secrets. |
| ngrok compatibility in application/test code | Existing frontend API client and tests, hardware response classification/tests, and stationary-runtime smoke scripts. These are outside PR #188's file list. | Once all clients use the managed API hostname and ngrok is no longer a supported test path, remove the ngrok-only request header/error mapping and related tests/checks. Search for `ngrok` before deleting to catch all references. |
| Local OpenTelemetry Collector and Jaeger | Tracked test config in `observability/docker-compose.yml` and `observability/otel-collector.yaml`; starts only when explicitly invoked. Jaeger uses in-memory storage and the Collector prints metrics/logs to its debug exporter. | Stop and remove the local containers with `docker compose -f observability/docker-compose.yml down`. No persistent volume is configured by this Compose file. |
| PR #188 application instrumentation | The PR adds `backend/src/instrumentation.ts`, `backend/src/lib/{logger,metrics}.ts`, startup/shutdown hooks, request/auth/worker instrumentation, and OpenTelemetry dependencies in `backend/package.json` and `package-lock.json`. | After validation, revert these application changes and dependency additions if telemetry is not being retained. Remove the corresponding tests and environment-variable examples with the implementation. Keep this register and test evidence as historical documentation. |
| PR #188 dashboard and Grafana Cloud setup | Dashboard JSON is tracked at `observability/grafana/eki-backend-dashboard.json`; the dashboard, alert rules, and contact point mentioned in the PR description were configured separately in Grafana Cloud. | Delete the test dashboard and alert rules from Grafana Cloud if they were created only for this run, and remove the test contact point if one was created. Confirm whether any other service uses the Grafana stack before deleting the stack. Remove/unset the test OTLP endpoint and authorization header from the backend deployment secret store. Follow the provider's retention/deletion controls for already-ingested telemetry. |
| Emulator test scratch files | Firebase rules integration tests create copied rules/configuration under an OS temporary directory through `scripts/rules-for-emulator.mjs`. | The helper/test owns this scratch data and removes it. No manual repository cleanup is needed. |

## Cleanup order

1. Stop device traffic and both local dev servers; stop the ngrok agents.
2. Disable exporting immediately by setting `OTEL_SDK_DISABLED=true` or
   unsetting `OTEL_EXPORTER_OTLP_ENDPOINT` and any signal-specific endpoint.
3. Remove the test-only dashboard/rules and test credentials from Grafana Cloud
   and the deployment secret store. Review the stack's retention controls for
   telemetry already received.
4. Stop the local Collector/Jaeger stack. Remove a reserved ngrok endpoint only
   after confirming its hostname is not used by another test/device.
5. If PR #188 is not adopted as a permanent feature, revert the instrumentation,
   dashboard, local stack, dependency, and configuration changes described in
   the cleanup register. Regenerate the npm lockfile through the normal
   dependency workflow.
6. When replacing ngrok with a managed API domain, update the web and device
   configurations, validate TLS from the test device, then remove ngrok-only
   compatibility code and its tests.

## Safety notes

- PR #188 is conditional on an OTLP endpoint being configured; the environment
  example leaves the endpoint commented out. Keep any Grafana authorization
  header in a secret manager. Grafana documents direct OTLP credentials through
  environment configuration and recommends Collector-based handling for
  production pipelines ([Grafana Collector guidance](https://grafana.com/docs/opentelemetry/collector/opentelemetry-collector/)).
- OpenTelemetry warns that telemetry can contain personal and authentication
  data and calls for data minimization and review of instrumentation output
  ([sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)).
  PR #188's HTTP span hook redacts URL/path/query attributes because place
  searches can be present in query strings.
- ngrok agent endpoints live for the agent process; cloud endpoints are
  persistent resources. Verify the endpoint type in the account before cleanup
  ([ngrok endpoint types](https://ngrok.com/docs/ai-gateway/guides/creating-endpoints)).
- The test evidence in `docs/testing/` is retained. It describes past runs and
  should not be mistaken for a live service or an ongoing availability claim.

## Sources checked

- Repository root README, `docs/operations/NGROK_TUNNEL.md`,
  `docs/operations/LIVE_DEMO_RUNBOOK.md`, `docs/hardware/README.md`,
  `backend/.env.example`, and `docs/testing/LIVE_ESP32_LATENCY_RESULT.md`.
- PR #188 changed-file list and description, including the note that Grafana
  alert rules were configured outside the repository.
- [OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)
  and [Grafana's OpenTelemetry Collector guidance](https://grafana.com/docs/opentelemetry/collector/opentelemetry-collector/).
- [ngrok endpoint types](https://ngrok.com/docs/ai-gateway/guides/creating-endpoints).
