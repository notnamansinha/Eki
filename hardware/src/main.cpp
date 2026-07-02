#include <Arduino.h>
#include <TinyGPSPlus.h>

TinyGPSPlus gps;
#define gpsSerial Serial2

void setup() {
    Serial.begin(115200);
    gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
    delay(1000);

    Serial.println("\n========================================");
    Serial.println("  Eki GNSS Diagnostic Mode (No WiFi)");
    Serial.println("========================================\n");

    Serial.println("[GPS] Waiting for satellite fix...");
}

unsigned long lastPrint = 0;

void loop() {
    // Parse incoming NMEA sentences
    while (gpsSerial.available() > 0) {
        gps.encode(gpsSerial.read());
    }

    // Print stats to Serial every 1 second
    if (millis() - lastPrint >= 1000) {
        lastPrint = millis();

        if (gps.location.isValid()) {
            Serial.printf("[GNSS] Time: %02d:%02d:%02d | Lat: %.6f | Lng: %.6f | Speed: %.2f km/h | Sats: %d | HDOP: %.1f\n",
                gps.time.hour(), gps.time.minute(), gps.time.second(),
                gps.location.lat(),
                gps.location.lng(),
                gps.speed.kmph(),
                gps.satellites.value(),
                gps.hdop.isValid() ? gps.hdop.hdop() : 99.9
            );
        } else {
            Serial.printf("[GNSS] No location fix yet. Sats in view: %d | Time: %02d:%02d:%02d | Chars: %u\n",
                gps.satellites.isValid() ? gps.satellites.value() : 0,
                gps.time.isValid() ? gps.time.hour() : 0,
                gps.time.isValid() ? gps.time.minute() : 0,
                gps.time.isValid() ? gps.time.second() : 0,
                gps.charsProcessed()
            );
            if (gps.charsProcessed() < 10) {
                Serial.println("       (Warning: No serial data received from GPS module. Check wiring!)");
            }
        }
    }
}
