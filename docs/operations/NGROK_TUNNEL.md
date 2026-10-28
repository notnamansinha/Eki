# Stable ngrok tunnel for ESP32 bench testing

Last updated: 2026-10-27 12:00 IST (UTC+05:30).

This runbook replaces the rotating Cloudflare Quick Tunnel used during local
hardware tests. It gives the laptop backend a reusable HTTPS origin so restarting
the tunnel does not force an ESP32 rebuild and reflash.

This is a bench/demo workflow, not the production-hosting design tracked by
issue #122. The laptop, backend, and ngrok agent must remain online.

## Setup handoff checklist

Before handing the bench setup to device testing, confirm the workstation side
is complete:

- ngrok is installed, authenticated, and able to pass `ngrok diagnose`.
- The assigned development domain is started explicitly with `--url`; do not
  rely on a randomly generated tunnel URL.
- Google Cloud Application Default Credentials use the Firebase project needed
  by the backend, including its ADC quota project.
- Local and public `/health` requests both return HTTP 200 with `status: ok`.
- A browser-origin CORS preflight reaches the backend through ngrok.
- The backend keeps the frontend origin in `CORS_ORIGIN`; the ngrok backend URL
  belongs in frontend and firmware configuration instead.
- Authtokens, Firebase credentials, local environment files, and firmware
  secrets remain ignored and uncommitted.

The workstation checks do not complete the ESP32 handoff. Device testing still
requires the ignored `hardware/include/secrets.h` to contain the assigned ngrok
origin, the verified issuing root CA, Wi-Fi credentials, and device credentials.
Build and flash that configuration once, then confirm authenticated telemetry in
the serial monitor and backend. Ordinary backend or ngrok restarts using the same
domain do not require another flash.

## 1. One-time ngrok setup

Create an ngrok account and copy its assigned development domain from the ngrok
dashboard. Use the stable domain available to your account and pass it explicitly with
`--url`; confirm current account eligibility and limits in the dashboard.
Use the exact hostname shown by the dashboard or agent; ngrok may use suffixes
such as `ngrok-free.dev`, and the suffix should not be assumed in advance.

Install the ngrok agent, then save the account authtoken in ngrok's user-level
configuration:

```powershell
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
ngrok config check
```

Never put the authtoken in this repository, an environment example, firmware,
screenshots, or test logs.

## 2. Start and verify the backend tunnel

After setting backend `NODE_ENV=development` and `PORT=4000` as described in
[local setup](../GETTING_STARTED.md#local-development), also set
`TRUST_PROXY=loopback` in `backend/.env`. The ngrok agent connects to the
backend over loopback, so without it every internet client (devices, phones and
any anonymous caller who knows the tunnel URL) shares the agent's single
pre-auth rate-limit bucket, and a junk flood can return 429 to real ESP32s.
With `loopback`, Express trusts `X-Forwarded-For` only from a proxy on this
machine and keys each caller by the client address ngrok appends; forged
leading entries from remote callers are ignored. Only processes on the laptop
itself could forge a key. Start Terminal 1:

```powershell
npm run dev --workspace=backend
Invoke-RestMethod http://localhost:4000/health
```

Start ngrok in Terminal 2 using the exact assigned domain:

```powershell
$NgrokDomain = "<assigned-domain>" # for example: name.ngrok-free.dev
ngrok http 4000 --url "https://$NgrokDomain"
```

Keep both processes running. From Terminal 3 and from a phone on a different
network, verify:

```powershell
$BackendOrigin = "https://<assigned-domain>"
Invoke-RestMethod "$BackendOrigin/health"
```

Do not continue unless the public response is HTTP 200 with `status: ok`. The
ngrok inspection UI at `http://127.0.0.1:4040` can show request status and
latency, but it may expose authentication headers or location payloads; do not
share or retain unredacted captures.

## 3. Provision TLS trust once

The firmware must continue to validate HTTPS. ngrok manages and renews the
public server certificate, but the ESP32 still needs a trusted issuing root CA.

Inspect the certificate chain for the assigned hostname during provisioning:

```powershell
$NgrokDomain = "<assigned-domain>"
openssl s_client -showcerts -verify_return_error `
  -connect "${NgrokDomain}:443" -servername $NgrokDomain
```

Obtain the matching root certificate from the issuing CA's official repository
and verify its subject, issuer, validity, and SHA-256 fingerprint in the
controlled build environment. Do not copy an arbitrary certificate from a chat,
and do not pin the renewable leaf certificate shown first in the server chain.

Configure the ignored `hardware/include/secrets.h` once:

```cpp
#define BACKEND_URL "https://<assigned-domain>"
#define BACKEND_ROOT_CA \
  "-----BEGIN CERTIFICATE-----\n" \
  "<verified issuing root CA PEM>\n" \
  "-----END CERTIFICATE-----"
```

Build, flash, and confirm HTTPS telemetry:

```powershell
py -m platformio test --project-dir hardware -e native
py -m platformio run --project-dir hardware -e esp32dev
py -m platformio run --project-dir hardware -e esp32dev `
  --target upload --upload-port COM3
py -m platformio device monitor --project-dir hardware `
  --port COM3 --baud 115200
```

Hostname verification and clock validation remain enabled. A normal ngrok leaf
certificate renewal should validate against the same trusted root and therefore
does not require reflashing. Revalidate the chain before a planned demo because
the service can change its issuing chain in the future.

## 4. Configure other consumers

Use the same stable backend origin for the browser application:

- Set `NEXT_PUBLIC_BACKEND_URL` in the ignored frontend environment
  (`frontend/.env.local` or `frontend/.env.production`). The root build's CSP
  generator and web/backend contract check load these files the same way
  `next build` does, so the generated `connect-src` includes the origin the
  bundle calls; a value exported in the shell takes precedence.
- After changing a production backend origin, run `npm run build:production`
  before `firebase deploy --only hosting` (or `firestore:rules,hosting`). It
  regenerates the CSP in `firebase.json` and fails instead of deploying a policy
  that blocks the backend.
- Keep backend `CORS_ORIGIN` set to frontend origins, not the ngrok backend URL.
- Never set `BACKEND_URL` in `backend/.env`; the backend still listens locally.

Prefer Firebase Hosting for remote phones. Reserve the account's eligible backend domain for the tracker.
Exposing a second local frontend requires another eligible stable domain and the
corresponding Firebase Authentication/CORS configuration.

## 5. When is another ESP32 flash required?

| Change | Reflash? |
|---|---|
| Restart backend on the same laptop/port | No |
| Restart ngrok with the same explicit `--url` | No |
| ngrok renews the leaf certificate under the trusted root | No |
| Change backend application code | No |
| Change ngrok's local upstream port while retaining the public origin | No; update the ngrok command |
| Change the public origin's scheme, hostname, or port | Yes |
| Issuing root CA changes | Yes |
| Change Wi-Fi or device credentials | Yes |
| Change firmware behavior | Yes |

## 6. Limits and failure handling

Check current request/data quotas and remaining dashboard usage before every
field rehearsal. At one request per second, telemetry alone consumes about
3,600 requests per hour, including while stopped under the current firmware
policy; health checks and other API traffic add to that budget.

The free-plan browser interstitial is documented as not affecting API or other
programmatic requests. If a browser page is shown while manually opening the
health URL, verify the endpoint with `Invoke-RestMethod`; do not disable ESP32
TLS verification to work around it.

If telemetry fails:

1. Verify local `http://localhost:4000/health`.
2. Verify public `https://<assigned-domain>/health` from another network.
3. Confirm ngrok was started with the configured `--url`.
4. Check ngrok usage limits and the local inspection UI.
5. Confirm ESP32 time, DNS, hostname, and CA validation from redacted serial
   output.
6. Reflash only when the table above says the compiled configuration changed.

Current ngrok behavior and limits should be checked against the official
[agent documentation](https://ngrok.com/docs/agent/) and
[free-plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits/)
before relying on this workflow.
