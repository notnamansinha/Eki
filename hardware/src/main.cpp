#include "secrets.h"
#include <Arduino.h>
#include <Firebase_ESP_Client.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>

// ── Bus Identity ──────────────────────────────────────────────────
#define BUS_ID     "bus_01"
#define ROUTE_ID   "route_01"
#define DRIVER_ID  "hw_device"

// ── Smart Transmission Thresholds ─────────────────────────────────
#define DISTANCE_THRESHOLD_M        10.0   // Minimum meters moved to trigger send
#define HEADING_THRESHOLD_DEG       15.0   // Minimum heading change (degrees)
#define SPEED_THRESHOLD_KMH         5.0    // Minimum speed change (km/h)

// Tiered heartbeat: longer interval when stationary to reduce idle RTDB writes
#define MAX_SILENT_INTERVAL_MOVING  30000  // 30 s when active/moving
#define MAX_SILENT_INTERVAL_IDLE   300000  // 5 min when idle (stationary at stop/terminus)

#define STOP_SPEED_KMH              2.0    // Below this = "stopped"
#define MOVING_SPEED_KMH            5.0    // Above this = "moving" (jitter filter)

// ── HDOP Dual Threshold ───────────────────────────────────────────
// HDOP < 2.5  → accurate, write normally
// 2.5 ≤ HDOP ≤ 4.0 → write with lowAccuracy:true flag (frontend shows "near stop X")
// HDOP > 4.0  → reject write entirely (positional error > ±20m in urban canyons)
#define HDOP_REJECT_THRESHOLD       4.0
#define HDOP_LOW_ACCURACY_THRESHOLD 2.5

// ── Hysteresis for active/idle status transitions ─────────────────
// Prevents rapid active↔idle oscillation at threshold boundary (e.g., 7–9 km/h)
#define ACTIVE_SPEED_THRESHOLD_KMH  8.0    // Enter active only above this
#define IDLE_SPEED_THRESHOLD_KMH    5.0    // Drop to idle only below this
#define HYSTERESIS_READINGS         3      // Must hold state for N consecutive readings

// ── Objects ───────────────────────────────────────────────────────
TinyGPSPlus gps;
#define gpsSerial Serial2
FirebaseData fbData;
FirebaseAuth fbAuth;
FirebaseConfig fbConfig;

// ── State tracking ────────────────────────────────────────────────
double smoothedLat = 0.0;
double smoothedLng = 0.0;
double lastSentHeading = 0.0;
double lastSentSpeed = 0.0;
unsigned long lastSendTime = 0;
unsigned long lastCheckTime = 0;
bool wasMoving = false;
bool firebaseReady = false;

// ── Hysteresis state ──────────────────────────────────────────────
static uint8_t consecutiveActiveReadings = 0;
static uint8_t consecutiveIdleReadings = 0;
static bool statusActive = false;  // Current hysteresis-gated status

// ── GPS fix-loss tracking ─────────────────────────────────────────
static bool gpsFixLost = false;
static unsigned long fixLostTime = 0;
static bool fixLostStatusWritten = false; // Only write maintenance status once per outage

// ── Token tracking ────────────────────────────────────────────────
unsigned long lastTokenFetch = 0;
const unsigned long TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes (before 60-min expiry)

// ── WiFi buffer for connectivity drops ───────────────────────────
struct BufferedFix {
    double lat, lng, speed, heading;
    int satellites;
    bool valid = false;
};
BufferedFix wifiBuffer;

// ── Meta write flag ───────────────────────────────────────────────
// Trip-start static metadata (busId, driverId, routeId, source) is written
// once to /activeBuses/bus_01_route_01/meta — not repeated on every update.
static bool metaWritten = false;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    // Keep feeding NMEA data so the hardware serial buffer doesn't overflow during WiFi reconnect
    while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] FAILED to connect. Will retry in loop.");
  }
}

#include <WiFiClientSecure.h>

bool fetchCustomToken() {
    if (WiFi.status() != WL_CONNECTED) return false;

    WiFiClientSecure client;
    // SEC-09: For absolute production security, replace setInsecure() with client.setCACert(root_ca);
    // setInsecure() allows HTTPS connections without validating the server's certificate chain,
    // which prevents crashes if the cert rotates, but exposes the device to MITM attacks.
    client.setInsecure();

    HTTPClient http;
    String url = String(BACKEND_URL) + "/api/devices/auth";
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<200> doc;
    doc["deviceId"] = BUS_ID;
    doc["secret"] = DEVICE_SECRET;
    
    String requestBody;
    serializeJson(doc, requestBody);

    Serial.println("[Auth] Fetching custom token from backend...");
    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode == 200) {
        String response = http.getString();
        StaticJsonDocument<512> respDoc;
        deserializeJson(respDoc, response);
        
        const char* token = respDoc["token"];
        if (token) {
            fbConfig.signer.tokens.custom_token = token;
            lastTokenFetch = millis();
            http.end();
            Serial.println("[Auth] ✅ Token obtained.");
            return true;
        }
    } else {
        Serial.printf("[Auth] Error code: %d, response: %s\n", httpResponseCode, http.getString().c_str());
    }
    
    http.end();
    return false;
}

void initFirebase() {
  fbConfig.host = FIREBASE_HOST;

  if (!fetchCustomToken()) {
      Serial.println("[Auth] Failed to get initial token. Will retry in loop.");
  }

  Firebase.begin(&fbConfig, &fbAuth);
  Firebase.reconnectNetwork(true);

  Serial.println("[Firebase] Initializing and waiting for token...");
  while (!Firebase.ready()) {
    Serial.print(".");
    delay(1000);
  }
  Serial.println("\n[Firebase] Ready!");
  firebaseReady = true;
}

// Haversine distance in meters between two GPS points
double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    double dLat = radians(lat2 - lat1);
    double dLng = radians(lng2 - lng1);
    double a = sin(dLat / 2) * sin(dLat / 2) +
               cos(radians(lat1)) * cos(radians(lat2)) *
               sin(dLng / 2) * sin(dLng / 2);
    double c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return 6371000.0 * c;
}

// Filter out GPS drift/jitter when stationary
double getFilteredSpeed() {
    double s = gps.speed.kmph();
    return (s < MOVING_SPEED_KMH) ? 0.0 : s;
}

// ── Update hysteresis state and return current bus status string ──
// Requires 3 consecutive readings above/below threshold to flip status.
// Prevents rapid active↔idle oscillation at the boundary (e.g., 7–9 km/h).
const char* updateAndGetStatus(double speed) {
    if (speed >= ACTIVE_SPEED_THRESHOLD_KMH) {
        consecutiveActiveReadings = min((int)consecutiveActiveReadings + 1, (int)HYSTERESIS_READINGS);
        consecutiveIdleReadings = 0;
    } else if (speed < IDLE_SPEED_THRESHOLD_KMH) {
        consecutiveIdleReadings = min((int)consecutiveIdleReadings + 1, (int)HYSTERESIS_READINGS);
        consecutiveActiveReadings = 0;
    }
    // In the dead-band (IDLE_THRESHOLD ≤ speed < ACTIVE_THRESHOLD): hold current state

    if (consecutiveActiveReadings >= HYSTERESIS_READINGS) statusActive = true;
    if (consecutiveIdleReadings >= HYSTERESIS_READINGS)   statusActive = false;

    return statusActive ? "active" : "idle";
}

bool shouldSendUpdate() {
    if (!gps.location.isValid()) return false;

    double currentLat = gps.location.lat();
    double currentLng = gps.location.lng();
    double currentSpeed = getFilteredSpeed();
    double currentHeading = gps.course.deg();
    unsigned long now = millis();

    // First fix ever — always send
    if (lastSendTime == 0) return true;

    // ── HDOP gate (evaluated BEFORE heartbeat) ──────────────────────────────
    // Hard-reject writes when HDOP exceeds reject threshold.
    // This prevents bad coordinates from contaminating the EMA or showing wrong stops.
    if (gps.hdop.isValid() && gps.hdop.hdop() > HDOP_REJECT_THRESHOLD) {
        return false; // Never write — not even heartbeat — during poor accuracy
    }

    // ── Tiered heartbeat ────────────────────────────────────────────────────
    // Use shorter interval when moving, longer when idle to reduce RTDB writes
    // during long terminus dwells (e.g., 30-min stop → 6 writes vs. 60).
    bool isCurrentlyIdle = getFilteredSpeed() <= STOP_SPEED_KMH;
    unsigned long maxSilent = isCurrentlyIdle
        ? MAX_SILENT_INTERVAL_IDLE    // 5 min
        : MAX_SILENT_INTERVAL_MOVING; // 30 s
    if (now - lastSendTime >= maxSilent) return true;

    // Distance moved exceeds threshold
    double dist = haversineMeters(smoothedLat, smoothedLng, currentLat, currentLng);
    if (dist >= DISTANCE_THRESHOLD_M) {
        if (currentSpeed > 0.0) return true;
    }

    // Heading changed significantly (handles 350° → 10° wraparound)
    double headingDiff = fabs(currentHeading - lastSentHeading);
    if (headingDiff > 180.0) headingDiff = 360.0 - headingDiff;
    if (headingDiff >= HEADING_THRESHOLD_DEG) {
        if (currentSpeed > 0.0) return true;
    }

    // Speed changed significantly
    if (fabs(currentSpeed - lastSentSpeed) >= SPEED_THRESHOLD_KMH) return true;

    // Bus just stopped or started
    bool isMoving = currentSpeed > STOP_SPEED_KMH;
    if (wasMoving && !isMoving) return true;
    if (!wasMoving && isMoving) return true;

    return false;
}

void updateLastSentState() {
    double currentLat = gps.location.lat();
    double currentLng = gps.location.lng();

    // ── EMA jitter suppression ─────────────────────────────────────────────
    // Don't update EMA during poor HDOP — prevents EMA from drifting toward bad coords
    bool hdopOk = !gps.hdop.isValid() || gps.hdop.hdop() <= HDOP_REJECT_THRESHOLD;

    if (hdopOk) {
        if (smoothedLat == 0.0) {
            smoothedLat = currentLat;
            smoothedLng = currentLng;
        } else {
            const double alpha = 0.3;
            smoothedLat = (alpha * currentLat) + ((1.0 - alpha) * smoothedLat);
            smoothedLng = (alpha * currentLng) + ((1.0 - alpha) * smoothedLng);
        }
    }

    lastSentHeading = gps.course.deg();
    lastSentSpeed = getFilteredSpeed();
    lastSendTime = millis();
    wasMoving = getFilteredSpeed() > STOP_SPEED_KMH;
}

// ── Write static trip metadata once per session ───────────────────
// Fields that don't change during a trip (busId, driverId, routeId, source)
// are written to /meta sub-path on startup. Subsequent location patches omit them.
void writeBusMeta() {
    String metaPath = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID + "/meta";
    FirebaseJson meta;
    meta.set("busId",    BUS_ID);
    meta.set("driverId", DRIVER_ID);
    meta.set("routeId",  ROUTE_ID);
    meta.set("source",   "gnss_hw");

    if (Firebase.RTDB.updateNode(&fbData, metaPath.c_str(), &meta)) {
        Serial.println("[RTDB] ✅ Bus meta written (busId, routeId, source).");
        metaWritten = true;
    } else {
        Serial.printf("[RTDB] ⚠️  Meta write failed: %s\n", fbData.errorReason().c_str());
    }
}

void sendLocationToRTDB() {
    if (!gps.location.isValid()) {
        Serial.println("[GPS] No valid fix yet. Skipping send.");
        return;
    }

    // If WiFi is down, save the fix to buffer
    if (WiFi.status() != WL_CONNECTED) {
        wifiBuffer.lat = gps.location.lat();
        wifiBuffer.lng = gps.location.lng();
        wifiBuffer.speed = getFilteredSpeed();
        wifiBuffer.heading = gps.course.deg();
        wifiBuffer.satellites = gps.satellites.value();
        wifiBuffer.valid = true;
        Serial.println("[WiFi] Not connected. Buffered GPS fix.");
        return;
    }

    // Write static meta once per trip (reduces per-update payload size)
    if (!metaWritten) {
        writeBusMeta();
    }

    double lat, lng, speed, heading, hdop;
    int sats;

    // Use buffered fix if available, else current GPS reading
    if (wifiBuffer.valid) {
        lat = wifiBuffer.lat;
        lng = wifiBuffer.lng;
        speed = wifiBuffer.speed;
        heading = wifiBuffer.heading;
        sats = wifiBuffer.satellites;
        hdop = gps.hdop.hdop();
        wifiBuffer.valid = false;
        Serial.println("[GPS] Sending buffered fix.");
    } else {
        lat = gps.location.lat();
        lng = gps.location.lng();
        speed = getFilteredSpeed();
        heading = gps.course.deg();
        sats = gps.satellites.value();
        hdop = gps.hdop.hdop();
    }

    // ── Build lean coordinate payload (~120 bytes vs. ~285 bytes full payload) ──
    // Static fields (busId, routeId, driverId, source) are in /meta — written once.
    String path = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID;
    FirebaseJson payload;
    payload.set("lat",       lat);
    payload.set("lng",       lng);
    payload.set("heading",   heading);
    payload.set("speed",     speed);

    // ── Hysteresis-gated status (prevents rapid active/idle oscillation) ──
    const char* status = updateAndGetStatus(speed);
    payload.set("status",    status);

    payload.set("timestamp/.sv", "timestamp");  // Firebase server-injected timestamp
    payload.set("satellites", sats);
    payload.set("hdop",      hdop);

    // ── HDOP accuracy flag (for frontend to downgrade confidence display) ──
    // "near stop X" instead of "at stop X" when GPS accuracy is reduced
    bool lowAccuracy = gps.hdop.isValid() && hdop > HDOP_LOW_ACCURACY_THRESHOLD;
    payload.set("lowAccuracy", lowAccuracy);

    // Use PATCH (updateNode) not SET — preserves /meta sub-path and other fields
    if (Firebase.RTDB.updateNode(&fbData, path.c_str(), &payload)) {
        Serial.printf("[RTDB] ✅ Sent: %.6f, %.6f | Speed: %.1f | Status: %s | HDOP: %.1f%s\n",
                      lat, lng, speed, status, hdop, lowAccuracy ? " ⚠️ lowAcc" : "");
    } else {
        Serial.printf("[RTDB] ❌ Failed: %s\n", fbData.errorReason().c_str());
    }
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("  Eki BusTrack — ESP32 Phase 6");
  Serial.println("  Tiered Heartbeat, Hysteresis, HDOP Dual-Threshold");
  Serial.println("  Lean Payload, Fix-Loss Tracking");
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

    unsigned long now = millis();

    // ── Proactive token refresh at 50 minutes (before 60-min Firebase expiry) ──
    if (lastTokenFetch > 0 && (now - lastTokenFetch >= TOKEN_REFRESH_INTERVAL_MS)) {
        if (fetchCustomToken()) {
            Serial.println("[Auth] Successfully refreshed Custom Token.");
        }
    }

    // ── GPS fix-loss detection and EMA flush on re-acquisition ────────────────
    if (!gps.location.isValid()) {
        if (!gpsFixLost) {
            gpsFixLost = true;
            fixLostTime = now;
            fixLostStatusWritten = false;
            Serial.println("[GPS] ⚠️  Fix lost — entering maintenance state.");
        }

        // Write maintenance status once so the frontend shows "GPS signal lost"
        // instead of showing a frozen marker or misleading idle status.
        if (firebaseReady && WiFi.status() == WL_CONNECTED && !fixLostStatusWritten) {
            String path = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID;
            FirebaseJson statusPayload;
            statusPayload.set("status", "maintenance");
            statusPayload.set("lowAccuracy", true);
            statusPayload.set("timestamp/.sv", "timestamp");
            if (Firebase.RTDB.updateNode(&fbData, path.c_str(), &statusPayload)) {
                fixLostStatusWritten = true;
                Serial.println("[RTDB] ✅ Maintenance status written (fix lost).");
            }
        }
        return; // Do not attempt shouldSendUpdate() without a valid fix
    }

    // ── GPS fix re-acquisition: flush EMA to new coordinate ──────────────────
    if (gpsFixLost) {
        gpsFixLost = false;
        // Reset EMA immediately to the new fix so heading and distance
        // calculations are accurate from the first re-acquired frame.
        smoothedLat = gps.location.lat();
        smoothedLng = gps.location.lng();
        Serial.printf("[GPS] ✅ Fix re-acquired after %lums. EMA reset to %.6f, %.6f\n",
                      now - fixLostTime, smoothedLat, smoothedLng);
        fixLostTime = 0;
    }

    // Check every 1 second if we should send (NOT every frame — save CPU)
    if (now - lastCheckTime >= 1000) {
        lastCheckTime = now;

        if (WiFi.status() != WL_CONNECTED) {
            connectWiFi();
            // Don't return here — we still need to buffer the fix
        }

        if (firebaseReady && (shouldSendUpdate() || (WiFi.status() == WL_CONNECTED && wifiBuffer.valid))) {
            sendLocationToRTDB();
            updateLastSentState();
        }
    }

    // Watchdog: if no NMEA data received in 5 seconds after boot, warn
    if (millis() > 5000 && gps.charsProcessed() < 10) {
        Serial.println("[GPS] ⚠️  No GPS data received — check wiring!");
    }
}
