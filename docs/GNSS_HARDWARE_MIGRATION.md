# ESP32 + NEO-M8N GNSS Hardware Integration — Complete Migration Guide

> **Project**: Eki (BusTrack)
> **Migration**: Browser Geolocation API → Dedicated ESP32 + NEO-M8N GNSS Module
> **Hardware**: ESP-WROOM-32 (30-Pin, CP2102) + NEO-M8N with Ceramic Active Antenna
> **Date**: June 2026

---

## Table of Contents

1. [Why This Migration](#1-why-this-migration)
2. [Architecture Comparison — Before vs. After](#2-architecture-comparison--before-vs-after)
3. [Hardware Inventory & Wiring](#3-hardware-inventory--wiring)
4. [Phase 1 — ESP32 WiFi + Firebase RTDB Connection](#4-phase-1--esp32-wifi--firebase-rtdb-connection)
5. [Phase 2 — GNSS Integration + Live Coordinate Streaming](#5-phase-2--gnss-integration--live-coordinate-streaming)
6. [Phase 3 — Smart Transmission & Firebase Cost Optimization](#6-phase-3--smart-transmission--firebase-cost-optimization)
7. [Phase 4 — Frontend Changes (Removing Driver Geolocation)](#7-phase-4--frontend-changes-removing-driver-geolocation)
8. [Phase 5 — Security & Authentication](#8-phase-5--security--authentication)
9. [Phase 6 — Testing, Debugging & Deployment](#9-phase-6--testing-debugging--deployment)
10. [Firebase Cost Breakdown & Optimization Summary](#10-firebase-cost-breakdown--optimization-summary)
11. [Full Data Flow — End to End](#11-full-data-flow--end-to-end)
12. [Troubleshooting & FAQ](#12-troubleshooting--faq)

---

## 1. Why This Migration

### The Problem with Browser Geolocation

The current system relies on the **driver's phone browser** calling `navigator.geolocation.getCurrentPosition()` every 3 seconds inside [driver/page.tsx](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L117-L142). This approach has fundamental limitations:

| Issue | Impact |
|---|---|
| **Phone dependency** | If the driver's phone battery dies, screen locks, or browser tab gets killed by the OS, tracking stops silently |
| **GPS accuracy** | Phone GPS uses assisted-GPS (A-GPS) which relies on cell towers — accuracy degrades in rural/semi-urban bus corridors to 15–50m |
| **Battery drain** | `enableHighAccuracy: true` with a 3-second poll interval hammers the phone's GPS radio, draining the driver's personal phone |
| **Consistency** | Different phones, different Android/iOS versions, different GPS chipsets — wildly inconsistent accuracy across your fleet |
| **Mock locations** | Trivially spoofable — any driver can install a mock-GPS app |
| **Browser throttling** | Chrome on Android throttles `setInterval` and `geolocation` when the tab is backgrounded. After ~5 minutes in background, updates can slow to once per minute or stop entirely |
| **Driver compliance** | Requires the driver to keep a browser tab open, logged in, with location permissions granted — too many failure points |

### What the Hardware Solves

A dedicated **NEO-M8N GNSS module** with **ceramic active antenna** mounted on the bus dashboard, connected to an **ESP32** pulling WiFi from the bus's onboard router, eliminates every single problem above:

| Advantage | Detail |
|---|---|
| **Always-on** | Powered by the bus's 12V/5V system — runs as long as the bus runs |
| **Sub-meter accuracy** | NEO-M8N with active antenna in open sky: **2.5m CEP** (circular error probable). With SBAS enabled: **~1.5m** |
| **No driver dependency** | Zero interaction required. The device boots, connects WiFi, acquires fix, and streams. The driver doesn't touch it |
| **Tamper-resistant** | No mock GPS — the NMEA sentences come straight from the u-blox chipset via hardware UART |
| **Consistent fleet-wide** | Every bus has identical hardware = identical accuracy |
| **Background-proof** | Not a browser tab. It's bare-metal firmware. Nothing throttles it |
| **Cost** | ESP32 (~₹500) + NEO-M8N (~₹800) = ~₹1,300 per bus. A one-time hardware investment |

---

## 2. Architecture Comparison — Before vs. After

### 2.1 — BEFORE: Browser Geolocation Architecture

This is the current data flow as implemented across [driver/page.tsx](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx) and documented in [ARCHITECTURE.md](file:///c:/Users/Naman Sinha/Desktop/Eki/ARCHITECTURE.md#L86-L112):

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CURRENT ARCHITECTURE │
│ (Browser Geolocation Based) │
├─────────────────────────────────────────────────────────────────────────┤
│ │
│ ┌──────────────────────┐ │
│ │ Driver's Phone │ │
│ │ (Chrome/Safari) │ │
│ │ │ │
│ │ ┌────────────────┐ │ Every 3s via setInterval │
│ │ │ Browser Tab │ │ ┌──────────────────────────────┐ │
│ │ │ │ │ │ navigator.geolocation │ │
│ │ │ driver/page.tsx│──┼──│ .getCurrentPosition() │ │
│ │ │ │ │ │ │ │
│ │ │ │ │ │ Returns: lat, lng, heading, │ │
│ │ │ │ │ │ speed, accuracy │ │
│ │ └───────┬────────┘ │ └──────────────────────────────┘ │
│ │ │ │ │
│ └──────────┼───────────┘ │
│ │ │
│ │ Firebase Client SDK │
│ │ ref(rtdb, `activeBuses/${busId}_${routeId}`) │
│ │ set(busRef, payload) │
│ ▼ │
│ ┌──────────────────────┐ │
│ │ Firebase RTDB │ │
│ │ /activeBuses/ │ │
│ │ bus_01_route_01 │──────────┐ │
│ │ ├── lat │ │ onValue() listeners │
│ │ ├── lng │ │ │
│ │ ├── heading │ ▼ │
│ │ ├── speed │ ┌──────────────────┐ ┌──────────────────┐ │
│ │ ├── timestamp │ │ Passenger App │ │ Admin Dashboard │ │
│ │ ├── busId │ │ PassengerMap.tsx │ │ Fleet Map │ │
│ │ ├── routeId │ └──────────────────┘ └──────────────────┘ │
│ │ ├── driverId │ │
│ │ └── status │ │
│ └──────────────────────┘ │
│ │
└─────────────────────────────────────────────────────────────────────────┘
```

**How it works step-by-step:**

1. The driver opens the Eki web app on their phone and navigates to `/driver`
2. They select their Driver ID, Bus ID, and Route, then tap "Start Tracking"
3. `handleStartTracking()` fires, calling `setInterval(updateLocation, 3000)` — [line 145](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L145)
4. Every 3 seconds, `navigator.geolocation.getCurrentPosition()` is called — [line 119](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L119)
5. The browser asks the phone's OS for a GPS fix (A-GPS via cell tower + satellite)
6. The coordinates are packaged into a payload and written directly to Firebase RTDB at `activeBuses/{busId}_{routeId}` using the **Firebase Client SDK** — [lines 84–104](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L84-L104)
7. On the passenger side, `PassengerMap.tsx` listens to `activeBuses` via `onValue()` — [line 162](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx#L162) and renders bus markers
8. If GPS fails, the code falls back to **mock movement** (random drift) — [lines 131–137](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L131-L137)
9. `onDisconnect(busRef).remove()` ensures the bus disappears from the map if the browser tab closes — [line 114](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L114)

**Authentication flow:** The driver is authenticated via Firebase Auth (Google Sign-In). The RTDB write rules require `auth != null` — [database.rules.json](file:///c:/Users/Naman Sinha/Desktop/Eki/database.rules.json#L6).

**Key weaknesses in this flow:**
- The entire tracking pipeline depends on a browser tab staying alive
- `getCurrentPosition()` with `enableHighAccuracy: true` and `timeout: 5000` means if GPS takes >5s, it falls back to mock data (fake coordinates on a real bus!)
- The 3-second interval means **20 RTDB writes per minute per bus**. For a fleet of 50 buses: **1,000 writes/minute = 60,000 writes/hour**
- Each write is a full payload (~200 bytes × 20/min × 50 buses = ~12 MB/hour of bandwidth just for location writes)

---

### 2.2 — AFTER: ESP32 + GNSS Hardware Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ NEW ARCHITECTURE │
│ (ESP32 + NEO-M8N GNSS Based) │
├─────────────────────────────────────────────────────────────────────────┤
│ │
│ ┌──────────────────────────────────────────────┐ │
│ │ HARDWARE ON BUS │ │
│ │ │ │
│ │ ┌──────────────┐ UART (9600 baud) │ │
│ │ │ NEO-M8N │────────────────────┐ │ │
│ │ │ GNSS Module │ TX→RX16, RX→TX17 │ │ │
│ │ │ + Ceramic │ │ │ │
│ │ │ Active Ant. │ ▼ │ │
│ │ └──────────────┘ ┌────────────┐ │ │
│ │ │ ESP32 │ │ │
│ │ │ ESP-WROOM │ │ │
│ │ ┌──────────────┐ │ -32 │ │ │
│ │ │ Bus 12V │──5V USB───▶│ │ │ │
│ │ │ Cigarette │ │ TinyGPS++ │ │ │
│ │ │ Lighter / │ │ parses │ │ │
│ │ │ USB Port │ │ NMEA │ │ │
│ │ └──────────────┘ │ │ │ │
│ │ │ WiFi STA │ │ │
│ │ ┌──────────────┐ │ connects │ │ │
│ │ │ Bus WiFi │◀── WiFi ──│ to bus │ │ │
│ │ │ Router │ │ router │ │ │
│ │ └──────┬───────┘ └────────────┘ │ │
│ │ │ │ │
│ └─────────┼─────────────────────────────────────┘ │
│ │ │
│ │ HTTPS (Firebase REST API or Client SDK) │
│ │ PATCH /activeBuses/{busId}_{routeId}.json │
│ ▼ │
│ ┌──────────────────────┐ │
│ │ Firebase RTDB │ │
│ │ /activeBuses/ │ │
│ │ bus_01_route_01 │──────────┐ │
│ │ ├── lat │ │ onValue() listeners │
│ │ ├── lng │ │ (UNCHANGED from current) │
│ │ ├── heading │ ▼ │
│ │ ├── speed │ ┌──────────────────┐ ┌──────────────────┐ │
│ │ ├── timestamp │ │ Passenger App │ │ Admin Dashboard │ │
│ │ ├── busId │ │ PassengerMap.tsx │ │ Fleet Map │ │
│ │ ├── routeId │ │ (NO CHANGES) │ │ (NO CHANGES) │ │
│ │ ├── satellites │ └──────────────────┘ └──────────────────┘ │
│ │ ├── source:"hw" │ │
│ │ └── status │ │
│ └──────────────────────┘ │
│ │
│ ┌──────────────────────┐ │
│ │ Driver App │ No longer writes GPS data! │
│ │ driver/page.tsx │ Only reads from RTDB to display own bus │
│ │ │ on the DriverMap. Controls (start/stop │
│ │ │ shift, route selection) remain unchanged. │
│ └──────────────────────┘ │
│ │
└─────────────────────────────────────────────────────────────────────────┘
```

**How it works step-by-step:**

1. The bus ignition turns on → the 12V/5V USB adapter powers the ESP32
2. ESP32 boots, connects to the bus's onboard WiFi router (hardcoded SSID/password in firmware)
3. The NEO-M8N GNSS module (already wired to Serial2 on pins 16/17) begins receiving NMEA sentences from GPS/GLONASS/Galileo/BeiDou satellites
4. TinyGPS++ library parses the NMEA stream and extracts lat, lng, speed, heading, altitude, satellite count, and HDOP
5. The firmware applies **smart transmission logic**: only sends an update to Firebase if the bus has moved >10 meters OR heading changed >15° OR speed changed significantly OR 30 seconds have elapsed (whichever comes first)
6. The ESP32 sends an HTTPS PATCH request to the Firebase RTDB REST API: `PATCH https://{project}.firebaseio.com/activeBuses/{busId}_{routeId}.json?auth={serviceToken}`
7. Passengers and admin continue to consume this data via their existing `onValue()` listeners — **zero frontend code changes needed on the subscriber side**
8. When the bus ignition turns off → ESP32 loses power → RTDB `onDisconnect` cleanup removes the bus entry (or alternatively, the passenger app's 5-minute staleness check at [line 171](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx#L171) handles it)

---

### 2.3 — Side-by-Side Comparison Table

| Aspect | Before (Geolocation) | After (ESP32 + GNSS) |
|---|---|---|
| **GPS Source** | Phone's A-GPS (cell-assisted) | u-blox NEO-M8N (dedicated GNSS receiver) |
| **Antenna** | Phone's tiny internal patch antenna | Ceramic active antenna with LNA (Low Noise Amplifier) |
| **Accuracy** | 5–50m (varies by phone, environment) | 2.5m CEP (with SBAS: ~1.5m) |
| **Constellations** | GPS only (most phones) | GPS + GLONASS + Galileo + BeiDou (72-channel concurrent) |
| **Update Source** | `navigator.geolocation` in browser | Hardware UART → TinyGPS++ parser |
| **Connectivity** | Phone's mobile data (4G/5G) | Bus WiFi → ESP32 WiFi STA mode |
| **Power** | Driver's phone battery | Bus 12V/5V USB adapter (unlimited) |
| **Driver Interaction** | Must keep app open, logged in | Zero. Fully autonomous |
| **Spoofing Risk** | High (mock GPS apps) | None (hardware NMEA stream) |
| **Background Throttle** | Yes (Chrome/Android kills background tabs) | N/A (bare-metal firmware, no OS throttling) |
| **RTDB Write Frequency** | Fixed 3s interval = 20/min per bus | Smart delta-based = **3–8/min per bus** (60–75% reduction) |
| **RTDB Writes/hr (50 buses)** | 60,000 | ~15,000–24,000 |
| **Payload Size** | ~200 bytes (full overwrite via `set()`) | ~120 bytes (partial update via `PATCH`) |
| **Bandwidth/hr (50 buses)** | ~12 MB | ~2–3 MB |
| **Offline Handling** | Mock GPS fallback (fake data!) | Buffers last valid fix, retries on WiFi reconnect |
| **Cost per Bus** | ₹0 (uses driver's phone) | ~₹1,300 one-time hardware |
| **Ongoing Cost Impact** | Higher Firebase bill | 60–75% lower Firebase RTDB bill |
| **TTFF (Time to First Fix)** | 1–5s (A-GPS, fast but lower accuracy) | Cold: 26s, Warm: 1s, Hot: 1s (NEO-M8N battery-backed) |
| **Data Freshness** | 3s fixed (when it works) | 2–10s adaptive (based on movement) |
| **Failure Mode** | Silent — bus vanishes from map | Detectable — can monitor `satellites` and `source` fields |

---

## 3. Hardware Inventory & Wiring

### 3.1 — Components You Have

| Component | Specification | Role |
|---|---|---|
| **ESP32 ESP-WROOM-32** | 30-Pin, Micro-USB, CP2102, Dual Core 240MHz, WiFi + BLE | Microcontroller — connects to WiFi, runs firmware, sends data to Firebase |
| **NEO-M8N GPS Module** | u-blox M8N, 72-channel, GPS/GLONASS/Galileo/BeiDou, UART output at 9600 baud | GNSS receiver — outputs NMEA sentences containing lat/lng/speed/heading |
| **Ceramic Active Antenna** | Attached to NEO-M8N via U.FL/SMA connector, has built-in LNA | Receives satellite signals with much better sensitivity than a passive patch antenna |

### 3.2 — Additional Components Needed (for deployment)

| Component | Purpose | Approx. Cost |
|---|---|---|
| USB car charger (12V → 5V 2A) | Powers ESP32 from bus cigarette lighter | ₹200–400 |
| Micro-USB cable (1.5m) | Power + data during development, power-only for deployment | ₹100 |
| Small enclosure (3D printed or ABS box) | Protects ESP32 from dust, vibration | ₹100–300 |
| CR2032 coin cell battery (optional) | Battery backup for NEO-M8N's RTC — enables hot-start (1s TTFF) | ₹30 |
| Dupont jumper wires (F-F) | For wiring during prototyping | Already have these |

### 3.3 — Wiring Diagram

```
 ESP32 (30-Pin) NEO-M8N Module
 ┌──────────────────┐ ┌──────────────────┐
 │ │ │ │
 USB Power ──▶│ 5V (or VIN) │──── VCC ────▶│ VCC (3.3–5V) │
 │ │ │ │
 │ GND │──── GND ────▶│ GND │
 │ │ │ │
 │ GPIO 16 (RX2) │◀─── TX ────│ TX │
 │ │ │ │
 │ GPIO 17 (TX2) │──── RX ───▶│ RX │
 │ │ │ │
 └──────────────────┘ └──────────────────┘
 │
 ┌──────┴──────┐
 │ Ceramic │
 │ Active │
 │ Antenna │
 │ (U.FL/SMA) │
 └─────────────┘
```

> [!IMPORTANT]
> **Pin Mapping Confirmation**: Your existing [main.cpp](file:///c:/Users/Naman Sinha/Desktop/Eki/BusTracking/src/main.cpp#L13) already uses `gpsSerial.begin(9600, SERIAL_8N1, 16, 17)` — GPIO 16 as RX, GPIO 17 as TX on `Serial2`. This is the standard ESP32 UART2 configuration and matches the wiring above.

> [!WARNING]
> **Voltage**: The NEO-M8N modules commonly accept 3.3V–5V. If your module is a 3.3V-only variant, power it from the ESP32's **3V3** pin instead of **VIN/5V**. Check the module's markings. Most breakout boards with a voltage regulator accept 5V safely.

### 3.4 — Mounting on the Bus

- **Antenna placement**: Mount the ceramic active antenna on the **dashboard near the windshield** — it needs a clear line of sight to the sky. Avoid placing it under metal roofing. Use the adhesive pad on the antenna base to stick it to the dashboard.
- **ESP32 placement**: Can be hidden behind the dashboard or in a small enclosure near the cigarette lighter/USB port. It does NOT need sky visibility — only the antenna does.
- **Cable routing**: Run the antenna cable (typically 25cm) from the antenna on the dashboard to the ESP32 behind/under the dashboard. Use cable clips to secure.

---

## 4. Phase 1 — ESP32 WiFi + Firebase RTDB Connection

> **Goal**: Get the ESP32 connecting to the bus's WiFi and successfully writing a test value to Firebase RTDB. No GPS yet — just prove the cloud connection works.

### 4.1 — PlatformIO Configuration Update

Update your `platformio.ini` to add the Firebase and WiFi dependencies. Note that we are using the mature Firebase Arduino Client library instead of older libraries.

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200

lib_deps = 
 mikalhart/TinyGPSPlus @ ^1.0.3
 mobizt/Firebase Arduino Client Library for ESP8266 and ESP32 @ ^4.4.14
```

> [!NOTE]
> **Why this Firebase library?** It handles SSL/TLS, token refresh (vital for Service Accounts), and connection keepalive internally. It uses the Firebase REST API under the hood, meaning it doesn't maintain a persistent WebSocket like the JS SDK — each write is an HTTPS request.

### 4.2 — Firmware: Secrets Management & Firebase Setup

For security, we isolate all credentials from the main code. Create a new directory and file `include/secrets.h`. **Make sure to add `include/secrets.h` to your `.gitignore`!**

**`include/secrets.example.h`** (Commit this to Git as a template):
```cpp
#pragma once

// ── WiFi Credentials ──────────────────────────────────────────────
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"

// ── Firebase Configuration ────────────────────────────────────────
#define FIREBASE_HOST "your-project-id-default-rtdb.firebaseio.com"
#define FIREBASE_PROJECT_ID "your-project-id"
#define FIREBASE_CLIENT_EMAIL "firebase-adminsdk-xxx@your-project-id.iam.gserviceaccount.com"

static const char FIREBASE_PRIVATE_KEY[] = "-----BEGIN PRIVATE KEY-----\n"
"YOUR_PRIVATE_KEY_HERE\n"
"-----END PRIVATE KEY-----\n";
```

**`src/main.cpp`** (The main application logic using Service Accounts):
```cpp
#include <Arduino.h>
#include <Firebase_ESP_Client.h>
#include <WiFi.h>
#include "secrets.h" // ── All WiFi and Firebase secrets are imported from here

FirebaseData fbData;
FirebaseAuth fbAuth;
FirebaseConfig fbConfig;

void connectWiFi() {
 Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
 WiFi.mode(WIFI_STA);
 WiFi.begin(WIFI_SSID, WIFI_PASS);

 int attempts = 0;
 while (WiFi.status() != WL_CONNECTED && attempts < 40) {
 delay(500);
 Serial.print(".");
 attempts++;
 }

 if (WiFi.status() == WL_CONNECTED) {
 Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
 } else {
 Serial.println("\n[WiFi] FAILED to connect. Will retry in loop.");
 }
}

void setup() {
 Serial.begin(115200);
 delay(1000);
 Serial.println("\n========================================");
 Serial.println(" Eki BusTrack — ESP32 Phase 1");
 Serial.println(" WiFi + Firebase RTDB Test");
 Serial.println("========================================\n");

 connectWiFi();

 // Initialize Firebase using the Service Account defined in secrets.h
 Serial.printf("Firebase Client v%s\n\n", FIREBASE_CLIENT_VERSION);
 fbConfig.database_url = FIREBASE_HOST;

 // Set the service account credentials
 fbConfig.service_account.data.client_email = FIREBASE_CLIENT_EMAIL;
 fbConfig.service_account.data.project_id = FIREBASE_PROJECT_ID;
 fbConfig.service_account.data.private_key = FIREBASE_PRIVATE_KEY;

 // Assign the configuration and authentication to the Firebase instance
 Firebase.begin(&fbConfig, &fbAuth);
 Firebase.reconnectWiFi(true); // Reconnects if WiFi drops

 Serial.println("[Firebase] Initializing and waiting for token...");

 // Wait for Service Account token generation
 while (!Firebase.ready()) {
 Serial.print(".");
 delay(1000);
 }
 Serial.println("\n[Firebase] Ready!");

 // Test write
 if (Firebase.RTDB.setString(&fbData, "/deviceTest/esp32_status", "online")) {
 Serial.println("[Firebase] Test write SUCCESS — device is online in RTDB");
 } else {
 Serial.printf("[Firebase] Test write FAILED: %s\n", fbData.errorReason().c_str());
 }
}

void loop() {
 // Phase 1: Just keep alive and verify connection
 if (WiFi.status() != WL_CONNECTED) {
 Serial.println("[WiFi] Disconnected. Reconnecting...");
 connectWiFi();
 }
 delay(10000);
}
```

### 4.3 — Verification Checklist

- [ ] Flash the firmware via PlatformIO: `pio run --target upload`
- [ ] Open Serial Monitor at 115200 baud
- [ ] Confirm `[WiFi] Connected! IP: x.x.x.x` appears
- [ ] Confirm `[Firebase] Test write SUCCESS` appears
- [ ] Open Firebase Console → Realtime Database → Verify `/deviceTest/esp32_status` = `"online"`
- [ ] Delete `/deviceTest` after confirming — it was just a connectivity test

---

## 5. Phase 2 — GNSS Integration + Live Coordinate Streaming

> **Goal**: Combine the working WiFi+Firebase connection with the GNSS parser from your existing [main.cpp](file:///c:/Users/Naman Sinha/Desktop/Eki/BusTracking/src/main.cpp) to stream real GPS coordinates to RTDB at `activeBuses/{busId}_{routeId}`.

### 5.1 — Configuration Constants

Before writing the firmware, define these configuration values. In production, these would be stored in ESP32's NVS (Non-Volatile Storage) and configurable via a BLE setup app or a web config portal. For now, hardcode them:

```cpp
// ── Bus Identity ──────────────────────────────────────────────────
// Each ESP32 is assigned to one bus. These values match your Firestore 'buses' collection.
#define BUS_ID "bus_01"
#define ROUTE_ID "route_01" // Default route; can be overridden via RTDB command
#define DRIVER_ID "hw_device" // Identifies this as hardware-sourced data

// ── Timing ────────────────────────────────────────────────────────
#define GPS_SEND_INTERVAL_MS 5000 // Base interval: send every 5 seconds
#define GPS_STALE_TIMEOUT_MS 30000 // If no valid fix for 30s, mark as stale
```

### 5.2 — Full Phase 2 Firmware

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <TinyGPSPlus.h>
#include <Firebase_ESP_Client.h>

// ── WiFi ──────────────────────────────────────────────────────────
const char* WIFI_SSID = "BUS_WIFI_SSID";
const char* WIFI_PASS = "BUS_WIFI_PASSWORD";

// ── Firebase ──────────────────────────────────────────────────────
#define FIREBASE_HOST "bustrack-be165-default-rtdb.firebaseio.com"
#define FIREBASE_AUTH "YOUR_RTDB_DATABASE_SECRET"

// ── Bus Identity ──────────────────────────────────────────────────
#define BUS_ID "bus_01"
#define ROUTE_ID "route_01"
#define DRIVER_ID "hw_device"

// ── Timing ────────────────────────────────────────────────────────
#define SEND_INTERVAL_MS 5000

// ── Objects ───────────────────────────────────────────────────────
TinyGPSPlus gps;
#define gpsSerial Serial2
FirebaseData fbData;
FirebaseAuth fbAuth;
FirebaseConfig fbConfig;
FirebaseJson jsonPayload;

unsigned long lastSendTime = 0;
bool firebaseReady = false;

void connectWiFi() {
 if (WiFi.status() == WL_CONNECTED) return;
 Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
 WiFi.mode(WIFI_STA);
 WiFi.begin(WIFI_SSID, WIFI_PASS);
 int attempts = 0;
 while (WiFi.status() != WL_CONNECTED && attempts < 40) {
 delay(500);
 Serial.print(".");
 attempts++;
 }
 if (WiFi.status() == WL_CONNECTED) {
 Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
 } else {
 Serial.println("\n[WiFi] Connection failed. Will retry.");
 }
}

void initFirebase() {
 fbConfig.host = FIREBASE_HOST;
 fbConfig.signer.tokens.legacy_token = FIREBASE_AUTH;
 Firebase.begin(&fbConfig, &fbAuth);
 Firebase.reconnectNetwork(true);
 firebaseReady = true;
 Serial.println("[Firebase] Initialized.");
}

void sendLocationToRTDB() {
 if (!gps.location.isValid()) {
 Serial.println("[GPS] No valid fix yet. Skipping send.");
 return;
 }
 if (WiFi.status() != WL_CONNECTED) {
 Serial.println("[WiFi] Not connected. Skipping send.");
 return;
 }

 double lat = gps.location.lat();
 double lng = gps.location.lng();
 double speed = gps.speed.kmph();
 double heading = gps.course.deg();
 int sats = gps.satellites.value();
 double hdop = gps.hdop.hdop();
 double alt = gps.altitude.meters();

 // Build the RTDB path — matches the existing frontend schema
 String path = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID;

 // Build JSON payload — same schema as driver/page.tsx writes
 jsonPayload.clear();
 jsonPayload.set("busId", BUS_ID);
 jsonPayload.set("driverId", DRIVER_ID);
 jsonPayload.set("routeId", ROUTE_ID);
 jsonPayload.set("lat", lat);
 jsonPayload.set("lng", lng);
 jsonPayload.set("heading", heading);
 jsonPayload.set("speed", speed);
 jsonPayload.set("status", "active");
 jsonPayload.set("timestamp/.sv", "timestamp"); // Firebase server timestamp
 jsonPayload.set("currentStopIndex", 0); // Will be computed server-side later
 jsonPayload.set("delayMinutes", 0);

 // Extra fields unique to hardware tracking
 jsonPayload.set("source", "gnss_hw"); // Distinguishes from browser GPS
 jsonPayload.set("satellites", sats);
 jsonPayload.set("hdop", hdop);
 jsonPayload.set("altitude", alt);

 // Use PATCH (update) instead of SET (overwrite) — more efficient
 if (Firebase.RTDB.updateNode(&fbData, path.c_str(), &jsonPayload)) {
 Serial.printf("[RTDB] Sent: %.6f, %.6f | Speed: %.1f km/h | Sats: %d | HDOP: %.1f\n",
 lat, lng, speed, sats, hdop);
 } else {
 Serial.printf("[RTDB] Failed: %s\n", fbData.errorReason().c_str());
 }
}

void setup() {
 Serial.begin(115200);
 gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
 delay(1000);

 Serial.println("\n========================================");
 Serial.println(" Eki BusTrack — ESP32 Phase 2");
 Serial.println(" GNSS + Firebase RTDB Streaming");
 Serial.println("========================================\n");

 connectWiFi();
 initFirebase();
 Serial.println("[GPS] Waiting for satellite fix...");
}

void loop() {
 // Feed NMEA characters to TinyGPS++ parser
 while (gpsSerial.available() > 0) {
 gps.encode(gpsSerial.read());
 }

 // Send location at regular intervals
 unsigned long now = millis();
 if (now - lastSendTime >= SEND_INTERVAL_MS) {
 lastSendTime = now;

 if (WiFi.status() != WL_CONNECTED) {
 connectWiFi();
 }

 sendLocationToRTDB();
 }

 // Watchdog: if no NMEA data received in 5 seconds, warn
 if (millis() > 5000 && gps.charsProcessed() < 10) {
 Serial.println("[GPS] ️ No GPS data received — check wiring!");
 }
}
```

### 5.3 — Key Design Decisions

**Why `updateNode()` (PATCH) instead of `setJSON()` (PUT)?**
- `PUT` (`set()`) replaces the entire node — if another field exists (e.g., from an admin override), it gets deleted
- `PATCH` (`updateNode()`) merges only the specified fields — preserves anything else at that path
- Also slightly cheaper in Firebase billing since partial updates transfer fewer bytes

**Why `"timestamp/.sv": "timestamp"` instead of `millis()` or `Date.now()`?**
- This is a Firebase server value — the RTDB server stamps the exact time it processes the write
- Eliminates clock drift issues between the ESP32 and the cloud
- The passenger app's staleness check at [PassengerMap.tsx:171](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx#L171) compares `Date.now() - bus.timestamp < 300000` — using server timestamps keeps this comparison accurate

**Why `"source": "gnss_hw"`?**
- Allows the frontend (and analytics) to distinguish hardware-sourced GPS data from browser-sourced data
- Useful during the transition period when some buses have hardware and others still use driver phones
- The frontend can show a "GPS quality" indicator based on `satellites` and `hdop` fields

### 5.4 — Verification Checklist

- [ ] Flash firmware, open Serial Monitor
- [ ] Wait for `[WiFi] Connected!` followed by `[GPS] Waiting for satellite fix...`
- [ ] Take the ESP32 + antenna near a **window or outdoors** — first fix takes 26–60 seconds (cold start)
- [ ] Confirm `[RTDB] Sent: 23.xxxxxx, 72.xxxxxx | Speed: 0.0 km/h | Sats: 8 | HDOP: 1.2` appears
- [ ] Open Firebase Console → RTDB → `/activeBuses/bus_01_route_01` → verify all fields present
- [ ] Open the **Passenger App** → select the route → confirm the bus appears on the map with real-time updates
- [ ] Walk around with the device and verify the bus marker moves on the passenger map

---

## 6. Phase 3 — Smart Transmission & Firebase Cost Optimization

> **Goal**: Reduce Firebase RTDB writes by 60–75% using intelligent delta-based transmission — only send updates when the bus has actually moved, turned, or changed speed meaningfully.

This is the **most important phase for Firebase cost optimization**.

### 6.1 — The Cost Problem

Firebase RTDB charges based on:

| Metric | Free Tier (Spark) | Blaze (Pay-as-you-go) |
|---|---|---|
| Simultaneous connections | 100 | 200,000 |
| GB stored | 1 GB | $5/GB/month |
| GB downloaded | 10 GB/month | $1/GB |
| GB uploaded | — | Included in download |

The **real cost driver** is **downloaded data** — every `onValue()` listener on every passenger's phone receives every update. If you have:
- 50 buses × 20 writes/min (current 3s interval) = 1,000 events/min
- 200 passengers listening = 200,000 event deliveries/min
- Each event payload ≈ 200 bytes = 40 MB/min = **2.4 GB/hour** of downstream bandwidth

With smart transmission (5–8 writes/min per bus instead of 20):
- 50 buses × 6 writes/min = 300 events/min
- 200 passengers = 60,000 deliveries/min
- Each event ≈ 150 bytes (smaller PATCH) = 9 MB/min = **540 MB/hour**

**That's a ~78% reduction in Firebase bandwidth costs.**

### 6.2 — Smart Transmission Algorithm

The algorithm decides whether to send an update based on these conditions:

```
SEND an update if ANY of these are true:
 1. Distance moved since last send > DISTANCE_THRESHOLD (10 meters)
 2. Heading changed by > HEADING_THRESHOLD (15 degrees)
 3. Speed changed by > SPEED_THRESHOLD (5 km/h)
 4. Time since last send > MAX_SILENT_INTERVAL (30 seconds)
 5. Bus just stopped (speed dropped to 0 from >5 km/h — likely at a bus stop)
 6. Bus just started moving (speed rose from 0 — departing a bus stop)

DO NOT SEND if:
 - Bus is stationary AND last send was <30s ago (bus is waiting at a stop/signal, don't spam)
 - GPS fix is invalid (no satellite lock)
 - WiFi is disconnected (buffer the fix, send when reconnected)
```

### 6.3 — Phase 3 Firmware Addition

Add these constants and logic to the Phase 2 firmware:

```cpp
// ── Smart Transmission Thresholds ─────────────────────────────────
#define DISTANCE_THRESHOLD_M 10.0 // Minimum meters moved to trigger send
#define HEADING_THRESHOLD_DEG 15.0 // Minimum heading change (degrees)
#define SPEED_THRESHOLD_KMH 5.0 // Minimum speed change (km/h)
#define MAX_SILENT_INTERVAL_MS 30000 // Force send every 30s even if stationary
#define STOP_SPEED_KMH 2.0 // Below this = "stopped"
#define MOVING_SPEED_KMH 5.0 // Above this = "moving"

// ── State tracking ────────────────────────────────────────────────
double lastSentLat = 0.0;
double lastSentLng = 0.0;
double lastSentHeading = 0.0;
double lastSentSpeed = 0.0;
unsigned long lastSentTime = 0;
bool wasMoving = false;

// Haversine distance in meters between two GPS points
double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
 double dLat = radians(lat2 - lat1);
 double dLng = radians(lng2 - lng1);
 double a = sin(dLat / 2) * sin(dLat / 2) +
 cos(radians(lat1)) * cos(radians(lat2)) *
 sin(dLng / 2) * sin(dLng / 2);
 double c = 2 * atan2(sqrt(a), sqrt(1 - a));
 return 6371000.0 * c; // Earth radius in meters
}

bool shouldSendUpdate() {
 if (!gps.location.isValid()) return false;

 double currentLat = gps.location.lat();
 double currentLng = gps.location.lng();
 double currentSpeed = gps.speed.kmph();
 double currentHeading = gps.course.deg();
 unsigned long now = millis();

 // First fix ever — always send
 if (lastSentTime == 0) return true;

 // Max silent interval exceeded — force send (heartbeat)
 if (now - lastSentTime >= MAX_SILENT_INTERVAL_MS) return true;

 // Distance moved exceeds threshold
 double dist = haversineMeters(lastSentLat, lastSentLng, currentLat, currentLng);
 if (dist >= DISTANCE_THRESHOLD_M) return true;

 // Heading changed significantly (handles 350° → 10° wraparound)
 double headingDiff = fabs(currentHeading - lastSentHeading);
 if (headingDiff > 180.0) headingDiff = 360.0 - headingDiff;
 if (headingDiff >= HEADING_THRESHOLD_DEG) return true;

 // Speed changed significantly
 if (fabs(currentSpeed - lastSentSpeed) >= SPEED_THRESHOLD_KMH) return true;

 // Bus just stopped
 bool isMoving = currentSpeed > STOP_SPEED_KMH;
 if (wasMoving && !isMoving) return true; // Was moving, now stopped
 if (!wasMoving && isMoving) return true; // Was stopped, now moving

 return false;
}

void updateLastSentState() {
 lastSentLat = gps.location.lat();
 lastSentLng = gps.location.lng();
 lastSentHeading = gps.course.deg();
 lastSentSpeed = gps.speed.kmph();
 lastSentTime = millis();
 wasMoving = gps.speed.kmph() > STOP_SPEED_KMH;
}
```

Then, in your `loop()`, replace the fixed-interval send with:

```cpp
void loop() {
 // Feed NMEA to parser
 while (gpsSerial.available() > 0) {
 gps.encode(gpsSerial.read());
 }

 // Check every 1 second if we should send (NOT every frame — save CPU)
 unsigned long now = millis();
 if (now - lastCheckTime >= 1000) {
 lastCheckTime = now;

 if (WiFi.status() != WL_CONNECTED) {
 connectWiFi();
 return;
 }

 if (shouldSendUpdate()) {
 sendLocationToRTDB();
 updateLastSentState();
 }
 }
}
```

### 6.4 — Expected Write Frequency

| Bus State | Before (Fixed 3s) | After (Smart Delta) | Reduction |
|---|---|---|---|
| **Moving straight on highway** | 20/min | 4–6/min (every ~10–15s, distance-triggered) | ~70% |
| **Turning at intersection** | 20/min | 8–10/min (heading changes trigger extra sends) | ~50% |
| **Stopped at bus stop** | 20/min | 2/min (only heartbeat every 30s) | ~90% |
| **Stopped in traffic** | 20/min | 2/min (heartbeat only) | ~90% |
| **Mixed urban driving** | 20/min | ~6/min average | ~70% |

### 6.5 — WiFi Reconnection Buffer

If WiFi drops momentarily (bus passes through a dead zone), buffer the last valid fix and send it immediately on reconnect:

```cpp
// In sendLocationToRTDB(), if WiFi is down:
struct BufferedFix {
 double lat, lng, speed, heading;
 int satellites;
 bool valid = false;
};

BufferedFix wifiBuffer;

// If WiFi is down, save the fix
if (WiFi.status() != WL_CONNECTED) {
 wifiBuffer.lat = gps.location.lat();
 wifiBuffer.lng = gps.location.lng();
 wifiBuffer.speed = gps.speed.kmph();
 wifiBuffer.heading = gps.course.deg();
 wifiBuffer.satellites = gps.satellites.value();
 wifiBuffer.valid = true;
 return;
}

// If WiFi just came back and we have a buffered fix, send it first
if (wifiBuffer.valid) {
  // Reconstruct payload using wifiBuffer values
  jsonPayload.set("lat", wifiBuffer.lat);
  jsonPayload.set("lng", wifiBuffer.lng);
  jsonPayload.set("speed", wifiBuffer.speed);
  jsonPayload.set("heading", wifiBuffer.heading);
  jsonPayload.set("satellites", wifiBuffer.satellites);
  
  // Transmit buffered data
  Firebase.RTDB.updateNode(&fbData, path.c_str(), &jsonPayload);
  
  // Clear buffer
  wifiBuffer.valid = false;
}
```

---

## 7. Phase 4 — Frontend Changes (Removing Driver Geolocation)

> **Goal**: Modify the Driver app so it no longer writes GPS data. The ESP32 handles all location publishing. The driver app becomes a **control panel** (start/stop shift, select route) and a **read-only map viewer**.

### 7.1 — What Changes

| File | Change | Impact |
|---|---|---|
| [driver/page.tsx](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx) | Remove `navigator.geolocation` calls, remove `writeLocationToRTDB()`, change `handleStartTracking()` to only set metadata in RTDB | **Major** |
| [PassengerMap.tsx](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx) | No changes — it already reads from `activeBuses/` which the ESP32 now writes to | **None** |
| [database.rules.json](file:///c:/Users/Naman Sinha/Desktop/Eki/database.rules.json) | Add a new write rule for device tokens (Phase 5) | Minor |
| [ARCHITECTURE.md](file:///c:/Users/Naman Sinha/Desktop/Eki/ARCHITECTURE.md) | Update GPS data flow diagram | Documentation |

### 7.2 — Conceptual Changes to driver/page.tsx

The driver app transforms from a **GPS transmitter** to a **shift controller**:

**Before (Current):**
```
Driver opens app → Selects bus/route → Clicks "Start" →
 App starts GPS polling →
 App writes lat/lng to RTDB every 3s →
 App sets onDisconnect cleanup

Driver clicks "Stop" →
 App stops GPS polling →
 App removes bus from RTDB
```

**After (With Hardware):**
```
ESP32 is already streaming GPS to RTDB automatically.
The driver app is optional for tracking — but needed for:
 - Setting the routeId (which route is the bus on?)
 - Controlling shift metadata (marking bus as "active" vs "idle")
 - Viewing the own-bus map
 - Handling messaging

Driver opens app → Selects bus/route → Clicks "Start Shift" →
 App writes SHIFT METADATA to RTDB:
 /busShifts/{busId}: { routeId, driverId, status: "active", startedAt }
 ESP32 firmware reads routeId from /busShifts/{busId} to stamp on GPS data

Driver clicks "End Shift" →
 App removes /busShifts/{busId}
 ESP32 detects no active shift → stops sending (or sends with status: "idle")
```

### 7.3 — How the Driver App Still Shows the Bus on the Map

Currently, `driverLocation` state is set by the GPS poll in `handleStartTracking()` — [line 127](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/app/driver/page.tsx#L127). This is then passed to `DriverMap` as a prop.

After the migration, the driver app should **read** the bus location from RTDB (same way the passenger app does) instead of producing it:

```typescript
// NEW: Read the bus position from RTDB (written by ESP32)
useEffect(() => {
 if (!busId || !isTracking) return;
 const busRef = ref(rtdb, `activeBuses/${busId}_${selectedRouteIds[0]}`);
 const unsubscribe = onValue(busRef, (snapshot) => {
 const data = snapshot.val();
 if (data && data.lat && data.lng) {
 setDriverLocation({
 lat: data.lat,
 lng: data.lng,
 heading: data.heading || 0,
 });
 }
 });
 return () => off(busRef, "value", unsubscribe);
}, [busId, selectedRouteIds, isTracking]);
```

> [!TIP]
> **Transition Strategy**: During the rollout, keep the geolocation fallback but add a `source` check. If `activeBuses/{busId}` already has `source: "gnss_hw"`, skip the browser GPS entirely. If not, fall back to the old geolocation flow. This way, buses WITH hardware get hardware GPS, and buses WITHOUT hardware still work via the driver's phone.

### 7.4 — Passenger App — Zero Changes Required

The beauty of this architecture is that [PassengerMap.tsx](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx) doesn't care WHERE the data comes from. It simply listens to `onValue(ref(rtdb, "activeBuses"), ...)` — [line 162](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx#L162) — and renders whatever is there.

The ESP32 writes to the same RTDB path (`/activeBuses/{busId}_{routeId}`) with the same schema. The only additions are bonus fields (`source`, `satellites`, `hdop`, `altitude`) which the frontend can optionally display but doesn't need to function.

---

## 8. Phase 5 — Security & Authentication

> **Goal**: Replace the legacy database secret with proper device authentication.

### 8.1 — The Problem with Database Secrets

In Phase 1–2, we used a **legacy RTDB database secret** (`FIREBASE_AUTH` constant). This is essentially a master key — anyone with this string can read/write anything in your RTDB. It's fine for development but **unacceptable for production**.

### 8.2 — Options for Device Authentication

| Method | Complexity | Security | Recommendation |
|---|---|---|---|
| **Legacy database secret** | Trivial | Very poor — if firmware is decompiled, entire RTDB is compromised | Development only |
| **Custom token via backend** | Medium | Good — ESP32 calls your backend to get a short-lived Firebase token | **Recommended** |
| **Service account on device** | Medium | Moderate — service account JSON in firmware is extractable | Not ideal |
| **Firebase Auth anonymous sign-in** | Easy | Moderate — generates a UID, but any device can do it | Acceptable for MVP |

### 8.3 — Recommended Approach: Custom Token via Backend

**Flow:**
1. Each ESP32 is provisioned with a unique **device secret** (a random 32-byte string stored in NVS)
2. On boot, the ESP32 sends an HTTPS POST to your backend: `POST /api/devices/auth` with `{ deviceId: "bus_01", secret: "..." }`
3. The backend validates the device secret against Firestore's `devices` collection using `bcrypt`
4. If valid, the backend generates a **Firebase Custom Token** using the Admin SDK: `admin.auth().createCustomToken(deviceId)`
5. The ESP32 receives the custom token, uses it to authenticate with RTDB
6. Custom tokens expire after 1 hour — the ESP32 re-authenticates every 50 minutes

**Backend endpoint to add:**
```typescript
// backend/src/routes/devices.ts
router.post("/auth", async (req, res) => {
 const { deviceId, secret } = req.body;
 const deviceDoc = await db.collection("devices").doc(deviceId).get();
 
 if (!deviceDoc.exists) {
   return res.status(401).json({ error: "Invalid device credentials" });
 }
 
 const isValid = await bcrypt.compare(secret, deviceDoc.data()?.secretHash);
 if (!isValid) {
   return res.status(401).json({ error: "Invalid device credentials" });
 }
 
 const customToken = await auth.createCustomToken(deviceId, { deviceId, role: "device" });
 res.json({ token: customToken, expiresIn: 3600 });
});
```

**ESP32 Firmware addition (Phase 5):**
```cpp
#include <HTTPClient.h>
#include <ArduinoJson.h> // Ensure ArduinoJson v7 is installed

// Store the custom token globally so the pointer remains valid
String currentCustomToken = "";

// Replace initFirebase() from Phase 2 with this:
void initFirebase() {
  HTTPClient http;
  http.begin("https://your-backend.com/api/devices/auth");
  http.addHeader("Content-Type", "application/json");

  // Send the device secret
  String payload = "{\"deviceId\":\"bus_01\",\"secret\":\"YOUR_DEVICE_SECRET\"}";
  int httpCode = http.POST(payload);

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument doc;
    deserializeJson(doc, response);
    
    // Assign to global String to prevent dangling pointer when passing c_str()
    currentCustomToken = doc["token"].as<String>();

    fbConfig.host = FIREBASE_HOST;
    fbConfig.signer.tokens.custom_token = currentCustomToken.c_str(); // Use custom token!
    Firebase.begin(&fbConfig, &fbAuth);
    Firebase.reconnectNetwork(true);
    firebaseReady = true;
    Serial.println("[Firebase] Initialized with Custom Token.");
  } else {
    Serial.printf("[Firebase] Auth Failed. HTTP %d\n", httpCode);
  }
  http.end();
}
```

### 8.4 — Updated RTDB Rules

Update [database.rules.json](file:///c:/Users/Naman Sinha/Desktop/Eki/database.rules.json) to allow both authenticated users (drivers via browser) and authenticated devices (ESP32 via custom token):

```json
{
  "rules": {
    "activeBuses": {
      ".read": true,
      "$busKey": {
        ".write": "auth != null && (auth.token.admin == true || $busKey.matches(auth.token.deviceId + '_.*'))"
      }
    },
    "busShifts": {
      ".read": "auth != null",
      "$busId": {
        ".write": "auth != null && (auth.token.admin == true || auth.token.deviceId == $busId)"
      }
    }
  }
}
```

---

## 9. Phase 6 — Testing, Debugging & Deployment

### 9.1 — Bench Testing (At Your Desk)

| Test | How | Expected Result |
|---|---|---|
| WiFi connection | Power ESP32 via USB, monitor serial | `[WiFi] Connected!` within 10s |
| GPS cold start | Take ESP32+antenna to a window | First fix in 26–60s, `Sats: 4+` |
| Firebase write | Watch serial + Firebase Console | Data appears at `/activeBuses/bus_01_route_01` |
| Passenger map | Open passenger app on phone | Bus marker appears at your GPS location |
| Smart delta | Stand still for 60s | Only 2 writes (heartbeats), not 20 |
| Smart delta | Walk across room | Writes triggered when >10m moved |
| WiFi disconnect | Turn off WiFi router briefly | ESP32 reconnects, buffered fix sent |

### 9.2 — Road Testing (On the Bus)

| Test | How | Expected Result |
|---|---|---|
| Mount hardware | Antenna on dashboard, ESP32 under dash, USB power from bus | Device boots when bus starts |
| Full route test | Drive the bus route end-to-end | Bus marker tracks smoothly on passenger app |
| Tunnel/underpass | Drive through a GPS-blocked area | Marker holds last position, resumes after exit |
| Bus stop behavior | Stop at a bus stop for 2 min | Heartbeat writes only (2/min), not 20/min |
| Multi-passenger | Have 5+ phones open the passenger app | All phones show the same bus position in sync |
| Speed accuracy | Compare GPS speed to speedometer | Within ±3 km/h |
| Power cycle | Turn bus ignition off and on | ESP32 reconnects, GPS re-acquires in 1–5s (hot start) |

### 9.3 — Serial Monitor Debug Commands

Add a debug menu accessible via Serial Monitor for field troubleshooting:

```
Command via Serial → Action:
 "status" → Print WiFi status, GPS fix status, last sent time
 "force" → Force an immediate RTDB write
 "gps" → Print raw GPS data (lat, lng, sats, hdop, speed)
 "wifi" → Print WiFi RSSI (signal strength)
 "reset" → Restart ESP32
```

### 9.4 — Deployment Checklist Per Bus

- [ ] Flash firmware with the correct `BUS_ID`, `ROUTE_ID`, WiFi credentials
- [ ] Store device secret in NVS (for Phase 5 auth)
- [ ] Mount ceramic antenna on dashboard with sky visibility
- [ ] Route antenna cable to ESP32 behind dashboard
- [ ] Connect ESP32 to USB car charger
- [ ] Verify green LED on NEO-M8N blinks (= has satellite fix)
- [ ] Verify data appears in Firebase RTDB under correct bus ID
- [ ] Verify passenger app shows the bus on the map
- [ ] Secure all cables with cable ties / clips to prevent vibration disconnection
- [ ] Label the ESP32 enclosure with the bus ID for identification

---

## 10. Firebase Cost Breakdown & Optimization Summary

### 10.1 — Cost Comparison (50-Bus Fleet, 12 hrs/day operation)

| Metric | Before (Geolocation) | After (Smart GNSS) | Savings |
|---|---|---|---|
| **Writes per bus per minute** | 20 | ~6 | 70% |
| **Total writes per hour** | 60,000 | 18,000 | 70% |
| **Total writes per day (12h)** | 720,000 | 216,000 | 70% |
| **Payload per write** | ~200B (full SET) | ~150B (PATCH) | 25% |
| **Upload bandwidth per day** | ~144 MB | ~32 MB | 78% |
| **Download per listener per day** | ~144 MB | ~32 MB | 78% |
| **200 listeners download/day** | **28.8 GB** | **6.4 GB** | **78%** |
| **Monthly download (30 days)** | **864 GB** | **192 GB** | **78%** |
| **RTDB cost at $1/GB** | **$864/mo** | **$192/mo** | **$672/mo saved** |

### 10.2 — Additional Firebase Optimization Techniques

Beyond smart transmission, these techniques further reduce costs:

| Technique | How | Impact |
|---|---|---|
| **Listener detachment** | Detach `onValue()` when passenger closes the app / switches tabs | Prevents orphaned connections downloading data for no one |
| **Path-specific listeners** | Listen to `/activeBuses/{busId}_{routeId}` per-route instead of all `/activeBuses/` | Passengers only download data for their route, not the entire fleet |
| **Payload minimization** | Use short field names in RTDB (`lt` instead of `lat`, `ln` instead of `lng`) | Reduces per-event payload by ~30% |
| **Connection budgeting** | Firebase Spark plan = 100 concurrent connections. With GNSS hardware, drivers no longer consume a connection for GPS writes (ESP32 uses REST, not WebSocket). Frees up connections for passengers | More headroom before hitting limits |
| **Staleness-based cleanup** | The frontend already checks `Date.now() - bus.timestamp < 300000` — buses older than 5 minutes are ignored. If the ESP32 loses power, the stale entry auto-expires client-side | No need for Cloud Functions to clean up |

### 10.3 — Spark (Free) Plan Feasibility

On the free Spark plan:
- 100 simultaneous connections, 10 GB/month download, 1 GB stored

With the GNSS hardware optimization:
- ESP32 uses REST API (no persistent connection) → 0 connections consumed per bus
- 50 passengers × 1 connection each = 50 connections (within limit)
- 6.4 GB/day download for 200 listeners... exceeds 10 GB/month free tier on **day 2**

**Verdict**: Even with 78% reduction, a 50-bus fleet with 200+ daily active passengers **will exceed the free tier**. But the optimized system is viable on Blaze at ~$192/month instead of ~$864/month.

> [!TIP]
> **For absolute minimum cost**: Add a secondary optimization layer — instead of individual `onValue()` listeners per bus, use a **Cloud Function** that aggregates all bus positions into a single RTDB node (`/fleetSnapshot`) updated every 3 seconds. Passengers listen to ONE path instead of N buses. This collapses all downstream bandwidth to a single event stream.

---

## 11. Full Data Flow — End to End

### 11.1 — Complete System Flow After Migration

```
STEP 1: HARDWARE BOOT
 Bus ignition ON → 12V adapter → 5V USB → ESP32 powers on
 ESP32 boots (takes ~2 seconds)
 ↓
STEP 2: WIFI CONNECTION
 ESP32 scans for configured SSID (bus WiFi router)
 Connects in ~3-5 seconds
 ↓
STEP 3: FIREBASE INIT
 ESP32 authenticates with Firebase (custom token via backend)
 Token valid for 1 hour, auto-refresh at 50min mark
 ↓
STEP 4: GPS ACQUISITION
 NEO-M8N begins receiving NMEA sentences
 Cold start: 26-60 seconds (first time or after long power-off)
 Hot start: 1 second (if battery-backed RTC coin cell installed)
 TinyGPS++ parses $GPRMC, $GPGGA sentences
 ↓
STEP 5: SMART TRANSMISSION LOOP
 Every 1 second, firmware checks shouldSendUpdate():
 - Moved >10m? → SEND
 - Turned >15°? → SEND
 - Speed change >5 km/h? → SEND
 - Stopped/started? → SEND
 - 30s heartbeat? → SEND
 - None of the above? → SKIP (save Firebase write)
 ↓
STEP 6: FIREBASE RTDB WRITE
 ESP32 sends HTTPS PATCH to:
 /activeBuses/{busId}_{routeId}.json
 Payload: { lat, lng, heading, speed, timestamp, source: "gnss_hw", satellites, hdop }
 ↓
STEP 7: REAL-TIME SYNC TO CLIENTS
 Firebase RTDB pushes the update to all active onValue() listeners:
 - PassengerMap.tsx (passenger phones)
 - Admin Fleet Map (admin dashboard)
 - DriverMap.tsx (driver's own phone, now read-only for GPS)
 Latency: typically <500ms from ESP32 write to client render
 ↓
STEP 8: PASSENGER MAP RENDER
 PassengerMap.tsx receives the bus data
 Calculates ETA to each stop based on bus speed + distance
 Renders bus marker with directional arrow
 Triggers haptic buzz when bus is <200m from target stop
 ↓
STEP 9: BUS IGNITION OFF
 12V adapter cuts power → ESP32 loses power
 Firebase RTDB's onDisconnect handler (if configured) removes the bus entry
 OR: PassengerMap staleness check (5min timeout) naturally hides the bus
```

### 11.2 — What the Driver App Does Now

```
STEP A: SHIFT START
 Driver opens Eki app → Selects bus ID + route → Taps "Start Shift"
 App writes to /busShifts/{busId}:
 { routeId, driverId, status: "active", startedAt: timestamp }
 ESP32 can optionally read this to determine which routeId to stamp on GPS data
 ↓
STEP B: DURING SHIFT
 Driver app reads bus position from RTDB (same as passengers)
 Shows the bus on DriverMap (read-only, no longer writing GPS)
 Driver can use messaging feature, view profile, etc.
 ↓
STEP C: SHIFT END
 Driver taps "End Shift"
 App removes /busShifts/{busId}
 App removes /activeBuses/{busId}_{routeId} (cleanup)
 App removes /messages/{busId} (cleanup)
```

---

## 12. Troubleshooting & FAQ

### "No GPS detected: check wiring"
- Verify TX on NEO-M8N goes to GPIO 16 (RX2) on ESP32
- Verify RX on NEO-M8N goes to GPIO 17 (TX2) on ESP32
- Verify VCC and GND are connected
- Check that the baud rate is 9600 (default for NEO-M8N)

### "GPS fix takes forever"
- Cold start can take 60+ seconds if no battery backup. This is normal.
- Make sure the ceramic active antenna has a clear view of the sky — not under a metal roof
- Add a CR2032 coin cell to the NEO-M8N's VBAT pin for hot-start capability (1s TTFF)

### "WiFi keeps disconnecting on the bus"
- Check the bus WiFi router's signal strength where the ESP32 is mounted
- Try using the ESP32's external antenna variant (ESP32-WROOM-32U) with an external WiFi antenna
- Implement exponential backoff on WiFi reconnection (not a tight loop)

### "Firebase write fails with 401"
- Your custom token has expired or is invalid
- Ensure the ESP32 is successfully fetching a new token from your backend every ~50 minutes
- If using custom tokens, check that the backend's service account has the `iam.serviceAccounts.signBlob` permission

### "Bus marker jumps erratically on the map"
- Check HDOP value — if >5.0, the GPS fix is poor (urban canyon, tree cover)
- Add a sanity check in firmware: skip sending if HDOP > 10.0 or satellites < 4
- Add a Kalman filter for production smoothing (advanced, Phase 7+)

### "Bus shows on passenger map even when bus is off"
- The 5-minute staleness check in [PassengerMap.tsx:171](file:///c:/Users/Naman Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx#L171) should handle this
- For faster cleanup, configure `onDisconnect` in the ESP32 firmware (requires persistent WebSocket connection, not REST)
- Or have the "End Shift" button in the driver app explicitly remove the RTDB entry

### "How to update firmware on deployed buses?"
- **Phase 7+ (OTA Updates)**: The ESP32 supports OTA (Over-The-Air) firmware updates via WiFi. Use the `ArduinoOTA` library or a custom HTTP OTA server. The ESP32 downloads the new binary from your server and flashes itself — no need to physically connect to each bus.
- For now, physically connect via USB and flash with PlatformIO.

---

> [!IMPORTANT]
> **Recommended Implementation Order**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6. Get the hardware streaming data first (Phases 1–3), then update the frontend (Phase 4). **CRITICAL**: You must lock down security (Phase 5) *before* testing end-to-end and deploying to production (Phase 6). Deploying firmware with hardcoded database secrets and permissive rules to production buses presents a severe security risk.

---

*Document version: 1.0 | Last updated: June 2026*
