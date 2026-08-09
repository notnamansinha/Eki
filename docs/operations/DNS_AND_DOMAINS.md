# Eki Web App DNS & Domain Setup Guide

This document defines the DNS record configurations, custom domain setups, SSL/TLS provisioning, and security integration rules required for deploying the Eki web application and backend API.

---

## 1. Architecture & Domain Overview

The Eki deployment consists of two primary endpoints:

1. **Frontend Web App (Next.js Static Export)**: Hosted on **Firebase Hosting**.
2. **Backend API (Node.js/Express)**: Hosted on a managed container platform (e.g., GCP Cloud Run, Compute Engine, or reverse proxy).

### Default vs. Production Custom Domains

| Component | Default Firebase Origin | Example Custom Domain |
|---|---|---|
| **Frontend Web App** | `bustrack-be165.web.app`<br>`bustrack-be165.firebaseapp.com` | `eki.yourdomain.com` or `bus.university.edu` |
| **Backend REST API** | Localhost / Tunnel / Cloud Run URL | `api.eki.yourdomain.com` or `bus-api.university.edu` |

---

## 2. Frontend DNS Configuration (Firebase Hosting)

To map a custom domain (e.g. `eki.yourdomain.com`) to Firebase Hosting:

### Step A: Add Custom Domain in Firebase Console
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Navigate to **Hosting** under project `bustrack-be165`.
3. Click **Add Custom Domain** and enter your domain name (e.g. `eki.yourdomain.com`).

### Step B: Add DNS Records in Domain Registrar / Campus DNS

Firebase Hosting will provide TXT and A records for domain ownership and SSL certificate provisioning:

| Record Type | Host / Name | Value / Target | Purpose |
|---|---|---|---|
| **TXT** | `_acme-challenge.eki.yourdomain.com` (or `@`) | `firebase=bustrack-be165...` | Domain ownership verification & SSL issuing |
| **A** | `eki.yourdomain.com` | `199.36.158.100` | Google Cloud/Firebase edge IP 1 |
| **A** | `eki.yourdomain.com` | `199.36.158.100` | Google Cloud/Firebase edge IP 2 |
| **CNAME** (Alternative for subdomains) | `eki` | `bustrack-be165.web.app.` | Points subdomain to Firebase Hosting |

*Note: Exact IP addresses and TXT tokens are provided during the Firebase Console setup flow.*

---

## 3. Firebase Auth Authorized Domains

When using a custom DNS domain for the frontend web app, Google Sign-In and Firebase Auth redirects **will fail** unless the domain is authorized.

1. Go to **Firebase Console** -> **Authentication** -> **Settings**.
2. Under **Authorized Domains**, click **Add Domain**.
3. Add `eki.yourdomain.com` (and `api.eki.yourdomain.com` if using popups/redirects).

---

## 4. Backend API DNS & HTTPS Configuration

The Express backend must sit behind a valid TLS/HTTPS endpoint with public or campus DNS resolution.

| Record Type | Host / Name | Value / Target | Description |
|---|---|---|---|
| **A / AAAA** | `api.eki.yourdomain.com` | `<SERVER_PUBLIC_IP>` | Direct IP pointing to backend/proxy server |
| **CNAME** | `api` | `<cloud-run-service>.a.run.app.` | CNAME pointing to Cloud Run / ALB endpoint |

### SSL/TLS Requirements
- Mandatory HTTPS (TLS 1.2+).
- Managed SSL via Let's Encrypt, Cloudflare, or GCP Managed Certificates.
- Export the **Root CA certificate** if using internal university enterprise CAs, as the ESP32 local provisioning flow requires it for TLS validation.

---

## 5. Environment & Security Header Alignment

### Frontend `.env.local` / `env.production`
```ini
NEXT_PUBLIC_BACKEND_URL=https://api.eki.yourdomain.com
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=bustrack-be165.firebaseapp.com
```

### Backend `.env`
```ini
CORS_ORIGIN=https://eki.yourdomain.com
BACKEND_URL=https://api.eki.yourdomain.com
```

### Firebase Hosting CSP (`firebase.json`)
If custom backend/API domains are used, ensure `firebase.json` headers permit connections:
- `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebasedatabase.app https://*.firebaseapp.com https://api.eki.yourdomain.com`

---

## 6. ESP32 Firmware & Hardware DNS Resolution

The ESP32 tracking hardware connects to the backend API via DNS hostname:

1. The backend origin submitted through the protected ESP32 provisioning portal must use `https://api.eki.yourdomain.com`.
2. Ensure the bus Wi-Fi / cellular hotspot provides working DNS servers (e.g. `8.8.8.8` / `1.1.1.1` or DHCP DNS).
3. If using an enterprise CA on campus DNS, include the complete root certificate in the provisioning form.

---

## 7. DNS & Setup Verification Checklist

- [ ] `nslookup eki.yourdomain.com` returns Firebase Hosting IPs / CNAME.
- [ ] `nslookup api.eki.yourdomain.com` resolves to backend public IP / endpoint.
- [ ] `curl -v https://eki.yourdomain.com` returns HTTP 200 with CSP and HSTS headers.
- [ ] `curl -v https://api.eki.yourdomain.com/health` returns HTTP 200.
- [ ] Firebase Auth sign-in works on `https://eki.yourdomain.com` without `auth/unauthorized-domain` errors.
- [ ] ESP32 serial logs display successful HTTP 200/202 responses when posting telemetry to `api.eki.yourdomain.com`.
