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

// ── WiFi reconnect interval ──────────────────────────────────────
// Power is not a concern (12V bus ignition), so we retry aggressively.
#define WIFI_RETRY_INTERVAL_MS      5000   // 5 s between reconnect attempts

// ── RTDB write failure backoff ────────────────────────────────────
// Prevents hammering Firebase RTDB at 1Hz when it is experiencing issues.
#define RTDB_INITIAL_BACKOFF_MS     2000
#define RTDB_MAX_BACKOFF_MS        60000   // 1 min cap

// ── GPS ring buffer for WiFi outage periods ───────────────────────
// Stores the last N fixes while WiFi is down. On reconnect, sends only the
// most-recent fix (avoids stale teleport artifact on passenger map).
// Keeping N=5 catches brief tunnel exits without wasting heap.
#define GPS_BUFFER_SIZE             5

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
const unsigned long TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 min (before 60-min expiry)

// ── GPS ring buffer for WiFi outage periods ───────────────────────
// On extended WiFi outage, we overwrite old entries (circular). On reconnect,
// only the latest (most recent) fix is sent — prevents marker teleporting.
struct BufferedFix {
    double lat, lng, speed, heading;
    int satellites;
    double hdop;
    bool valid = false;
};
static BufferedFix gpsRingBuffer[GPS_BUFFER_SIZE];
static uint8_t ringHead = 0;        // Points to next write slot
static uint8_t ringCount = 0;       // How many valid entries are buffered

// ── WiFi reconnect cooldown ──────────────────────────────────────
static unsigned long lastWifiAttemptTime = 0;

// ── RTDB write failure backoff state ─────────────────────────────
static unsigned long rtdbBackoffMs = RTDB_INITIAL_BACKOFF_MS;
static unsigned long lastRtdbFailTime = 0;
static bool rtdbInBackoff = false;

// ── Meta write flag ───────────────────────────────────────────────
// Trip-start static metadata (busId, driverId, routeId, source) is written
// once to /activeBuses/bus_01_route_01/meta — not repeated on every update.
static bool metaWritten = false;

// ── Safe elapsed time helper (handles millis() uint32 overflow at 49.7 days) ──
inline unsigned long elapsed(unsigned long since) {
    return millis() - since; // Unsigned subtraction wraps correctly on overflow
}

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    // Cooldown: don't spam reconnect attempts — wait 5s between tries
    if (lastWifiAttemptTime != 0 && elapsed(lastWifiAttemptTime) < WIFI_RETRY_INTERVAL_MS) {
        return;
    }
    lastWifiAttemptTime = millis();

    Serial.printf("[WiFi] Connecting to %s...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    // Wait up to 10s, feeding GPS serial throughout to prevent buffer overflow
    unsigned long waitStart = millis();
    while (WiFi.status() != WL_CONNECTED && elapsed(waitStart) < 10000) {
        while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
        delay(200);
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("[WiFi] Attempt failed. Will retry in 5s.");
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

    JsonDocument doc;
    doc["deviceId"] = BUS_ID;
    doc["secret"] = DEVICE_SECRET;
    
    String requestBody;
    serializeJson(doc, requestBody);

    Serial.println("[Auth] Fetching custom token from backend...");
    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode == 200) {
        String response = http.getString();
        JsonDocument respDoc;
        deserializeJson(respDoc, response);
        
        const char* token = respDoc["token"];
        if (token) {
            fbConfig.signer.tokens.custom_token = token;
            lastTokenFetch = millis();
            http.end();
            Serial.println("[Auth] Token obtained.");
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
    unsigned long fbWait = millis();
    while (!Firebase.ready()) {
        Serial.print(".");
        delay(500);
        // Safety timeout: don't block indefinitely on boot if RTDB is unreachable
        if (elapsed(fbWait) > 30000) {
            Serial.println("\n[Firebase] Timed out waiting for ready state. Continuing anyway.");
            break;
        }
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

// ── Update hysteresis state and return motionState string ────────
// Logic is identical to the old updateAndGetStatus(); only the output labels
// have changed to reflect the 3-state architecture:
//   moving    ← was "active"  (speed >= ACTIVE_SPEED_THRESHOLD_KMH for N readings)
//   stopped   ← was "idle"    (speed <  IDLE_SPEED_THRESHOLD_KMH  for N readings)
//   uncertain   written directly by the GPS fix-loss handler (was "maintenance")
// tripState is NOT computed here — the backend owns that via geofencing.
const char* getMotionState(double speed) {
    if (speed >= ACTIVE_SPEED_THRESHOLD_KMH) {
        consecutiveActiveReadings = min((int)consecutiveActiveReadings + 1, (int)HYSTERESIS_READINGS);
        consecutiveIdleReadings = 0;
    } else if (speed < IDLE_SPEED_THRESHOLD_KMH) {
        consecutiveIdleReadings = min((int)consecutiveIdleReadings + 1, (int)HYSTERESIS_READINGS);
        consecutiveActiveReadings = 0;
    }
    // In the dead-band (IDLE_THRESHOLD ≤ speed < ACTIVE_THRESHOLD): hold current state

    if (consecutiveActiveReadings >= HYSTERESIS_READINGS) statusActive = true;
    if (consecutiveIdleReadings   >= HYSTERESIS_READINGS) statusActive = false;

    return statusActive ? "moving" : "stopped";
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
    if (elapsed(lastSendTime) >= maxSilent) return true;

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

// ── Push current GPS fix into the ring buffer ─────────────────────
// Called when WiFi is down and a location update is due.
// Old entries are overwritten when the buffer is full (circular).
void bufferCurrentFix() {
    if (!gps.location.isValid()) return;
    gpsRingBuffer[ringHead] = {
        gps.location.lat(),
        gps.location.lng(),
        getFilteredSpeed(),
        gps.course.deg(),
        gps.satellites.value(),
        gps.hdop.isValid() ? gps.hdop.hdop() : 99.9,
        true
    };
    ringHead = (ringHead + 1) % GPS_BUFFER_SIZE;
    if (ringCount < GPS_BUFFER_SIZE) ringCount++;
    Serial.printf("[GPS] Fix buffered (%u in queue).\n", ringCount);
}

// ── Flush the ring buffer — send only the newest fix ──────────────
// Discards intermediate buffered fixes to avoid marker teleporting on the
// passenger map. Only the most-recently-recorded position is transmitted.
void flushBufferedFix() {
    if (ringCount == 0) return;

    // Most recent entry is at (ringHead - 1 + GPS_BUFFER_SIZE) % GPS_BUFFER_SIZE
    uint8_t latestIdx = (ringHead - 1 + GPS_BUFFER_SIZE) % GPS_BUFFER_SIZE;
    BufferedFix& fix = gpsRingBuffer[latestIdx];

    if (!fix.valid) return;

    Serial.printf("[GPS] Flushing buffered fix (discarded %u stale entries).\n", ringCount - 1);

    String path = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID;
    FirebaseJson payload;
    payload.set("lat",         fix.lat);
    payload.set("lng",         fix.lng);
    payload.set("heading",     fix.heading);
    payload.set("speed",       fix.speed);
    payload.set("deviceState", "online");
    payload.set("motionState", getMotionState(fix.speed));
    payload.set("timestamp/.sv", "timestamp");
    payload.set("satellites",  fix.satellites);
    payload.set("hdop",        fix.hdop);
    payload.set("lowAccuracy", fix.hdop > HDOP_LOW_ACCURACY_THRESHOLD);

    if (Firebase.RTDB.updateNode(&fbData, path.c_str(), &payload)) {
        Serial.println("[RTDB] Buffered fix sent.");
        rtdbBackoffMs = RTDB_INITIAL_BACKOFF_MS; // Reset on success
        rtdbInBackoff = false;
    } else {
        Serial.printf("[RTDB] Buffered fix send failed: %s\n", fbData.errorReason().c_str());
        // Don't clear buffer on failure — it will be retried on next successful window
    }

    // Clear the ring buffer regardless — data is now stale
    ringCount = 0;
    ringHead = 0;
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
        Serial.println("[RTDB] Bus meta written (busId, routeId, source).");
        metaWritten = true;
    } else {
        Serial.printf("[RTDB] Meta write failed: %s\n", fbData.errorReason().c_str());
    }
}

void sendLocationToRTDB() {
    if (!gps.location.isValid()) {
        Serial.println("[GPS] No valid fix yet. Skipping send.");
        return;
    }

    // ── WiFi down: push to ring buffer and return ─────────────────────────
    if (WiFi.status() != WL_CONNECTED) {
        bufferCurrentFix();
        return;
    }

    // ── RTDB write backoff guard ──────────────────────────────────────────
    // If RTDB is in a backoff period (due to repeated write failures), skip
    // this update entirely to avoid hammering Firebase during an outage.
    if (rtdbInBackoff && elapsed(lastRtdbFailTime) < rtdbBackoffMs) {
        Serial.printf("[RTDB] In backoff — skipping write for %lums.\n",
                      rtdbBackoffMs - elapsed(lastRtdbFailTime));
        return;
    }

    // Write static meta once per trip (reduces per-update payload size)
    if (!metaWritten) {
        writeBusMeta();
    }

    double lat = gps.location.lat();
    double lng = gps.location.lng();
    double speed = getFilteredSpeed();
    double heading = gps.course.deg();
    int sats = gps.satellites.value();
    double hdop = gps.hdop.isValid() ? gps.hdop.hdop() : 99.9;

    // ── Build lean coordinate payload (~120 bytes vs. ~285 bytes full payload) ──
    // Static fields (busId, routeId, driverId, source) are in /meta — written once.
    String path = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID;
    FirebaseJson payload;
    payload.set("lat",       lat);
    payload.set("lng",       lng);
    payload.set("heading",   heading);
    payload.set("speed",     speed);

    // ── Hysteresis-gated motionState (prevents rapid moving/stopped oscillation) ──
    const char* motionState = getMotionState(speed);
    // deviceState is always "online" when this function is executing on a connected device.
    // The backend sets deviceState:"offline" on socket disconnect / power cut.
    payload.set("deviceState", "online");
    payload.set("motionState", motionState);
    // tripState is intentionally NOT written here — the backend computes it
    // by geofencing the bus position against the route's stop coordinates.

    payload.set("timestamp/.sv", "timestamp");  // Firebase server-injected timestamp
    payload.set("satellites", sats);
    payload.set("hdop",      hdop);

    // ── HDOP accuracy flag (for frontend to downgrade confidence display) ──
    bool lowAccuracy = hdop > HDOP_LOW_ACCURACY_THRESHOLD;
    payload.set("lowAccuracy", lowAccuracy);

    // Use PATCH (updateNode) not SET — preserves /meta sub-path and other fields
    if (Firebase.RTDB.updateNode(&fbData, path.c_str(), &payload)) {
        Serial.printf("[RTDB] Sent: %.6f, %.6f | Speed: %.1f | Motion: %s | HDOP: %.1f%s\n",
                      lat, lng, speed, motionState, hdop, lowAccuracy ? " lowAcc" : "");
        // ── Reset backoff state on successful write ────────────────────────
        rtdbBackoffMs = RTDB_INITIAL_BACKOFF_MS;
        rtdbInBackoff = false;
    } else {
        Serial.printf("[RTDB] Write failed: %s\n", fbData.errorReason().c_str());
        // ── Engage exponential backoff on repeated RTDB failures ──────────
        lastRtdbFailTime = millis();
        rtdbInBackoff = true;
        rtdbBackoffMs = min(rtdbBackoffMs * 2, (unsigned long)RTDB_MAX_BACKOFF_MS);
        Serial.printf("[RTDB] Backoff engaged. Next retry in %lums.\n", rtdbBackoffMs);
    }
}

void setup() {
    Serial.begin(115200);
    gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
    delay(1000);

    Serial.println("\n========================================");
    Serial.println("  Eki BusTrack — ESP32 Phase 7");
    Serial.println("  Ring Buffer, Backoff Guards, Overflow-safe Timers");
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

    // ── Token Management (Refresh & Retry) ────────────────────────────────────
    if (lastTokenFetch == 0) {
        // CRITICAL FIX: If the initial token fetch failed on boot (e.g. backend down),
        // we must retry periodically. Otherwise the bus stays offline forever.
        static unsigned long lastTokenRetry = 0;
        if (elapsed(lastTokenRetry) >= 10000) { // Retry every 10 seconds
            lastTokenRetry = now;
            if (fetchCustomToken()) {
                Serial.println("[Auth] ✅ Successfully fetched initial Custom Token after retry.");
            }
        }
    } else if (elapsed(lastTokenFetch) >= TOKEN_REFRESH_INTERVAL_MS) {
        // Proactive token refresh at 50 minutes (before 60-min Firebase expiry)
        if (fetchCustomToken()) {
            Serial.println("[Auth] ✅ Successfully refreshed Custom Token.");
        }
    }

    // ── GPS fix-loss detection and EMA flush on re-acquisition ────────────────
    if (!gps.location.isValid()) {
        if (!gpsFixLost) {
            gpsFixLost = true;
            fixLostTime = now;
            fixLostStatusWritten = false;
            Serial.println("[GPS] Fix lost — entering maintenance state.");
        }

        // Write maintenance status once so the frontend shows "GPS signal lost"
        // instead of showing a frozen marker or misleading idle status.
        if (firebaseReady && WiFi.status() == WL_CONNECTED && !fixLostStatusWritten) {
            String path = String("/activeBuses/") + BUS_ID + "_" + ROUTE_ID;
            FirebaseJson statusPayload;
            // GPS fix lost → deviceState stays "online" (ESP32 is alive), but
            // motionState becomes "uncertain" (no trustworthy position data).
            // The backend will set tripState = "maintenance" when it sees this.
            statusPayload.set("deviceState", "online");
            statusPayload.set("motionState", "uncertain");
            statusPayload.set("lowAccuracy", true);
            statusPayload.set("timestamp/.sv", "timestamp");
            if (Firebase.RTDB.updateNode(&fbData, path.c_str(), &statusPayload)) {
                fixLostStatusWritten = true;
                Serial.println("[RTDB] motionState:uncertain written (GPS fix lost).");
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
        Serial.printf("[GPS] Fix re-acquired after %lums. EMA reset to %.6f, %.6f\n",
                      elapsed(fixLostTime), smoothedLat, smoothedLng);
        fixLostTime = 0;
    }

    // Check every 1 second if we should send (NOT every frame — save CPU)
    if (elapsed(lastCheckTime) >= 1000) {
        lastCheckTime = now;

        // ── WiFi reconnect ────────────────────────────────────────────────
        if (WiFi.status() != WL_CONNECTED) {
            connectWiFi(); // Non-blocking — respects 5s cooldown internally
        }

        // Only attempt Firebase writes if we have successfully obtained an auth token
        if (firebaseReady && lastTokenFetch > 0) {
            // Flush buffered GPS fixes if WiFi just came back
            if (WiFi.status() == WL_CONNECTED && ringCount > 0) {
                flushBufferedFix();
                updateLastSentState();
            }
            // Send live update if movement thresholds are met
            else if (shouldSendUpdate()) {
                sendLocationToRTDB();
                updateLastSentState();
            }
        }
    }

    // Watchdog: if no NMEA data received in 5 seconds after boot, warn (with cooldown)
    if (millis() > 5000 && gps.charsProcessed() < 10) {
        static unsigned long lastGpsWarn = 0;
        if (elapsed(lastGpsWarn) >= 5000) {
            lastGpsWarn = millis();
            Serial.println("[GPS] ⚠️ No GPS data received — check wiring!");
        }
    }
}
