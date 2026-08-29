# Stable ngrok tunnel for ESP32 bench testing

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
dashboard. The free plan currently supplies one assigned development domain;
it is stable across agent restarts when explicitly passed to `--url`.
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

Start the local backend in Terminal 1:

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

- Set `NEXT_PUBLIC_BACKEND_URL` in the ignored frontend environment.
- Regenerate the production CSP and redeploy Firebase Hosting after changing a
  production backend origin.
- Keep backend `CORS_ORIGIN` set to frontend origins, not the ngrok backend URL.
- Never set `BACKEND_URL` in `backend/.env`; the backend still listens locally.

Prefer Firebase Hosting for remote phones. A free ngrok account currently has
only one assigned development domain, which should be reserved for the backend.
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

The ngrok free plan is intended for development. Its documented limits include
20,000 HTTP requests and 1 GB of outbound data per month. At a one-second moving
telemetry cadence, 20,000 requests is only about 5.5 hours before health checks
and other API traffic, so check dashboard usage before every field rehearsal.

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
