#pragma once

/**
 * SECURITY: This file is the TEMPLATE — copy it to secrets.h and fill in your values.
 *
 * !! NEVER commit secrets.h to git. It is gitignored.
 * !! Never store a real WiFi password or Firebase private key in any tracked file.
 *
 * Setup:
 *   cp include/secrets.example.h include/secrets.h
 *   # Edit include/secrets.h with your real credentials
 */

// ── WiFi Credentials ──────────────────────────────────────────────
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"

// ── Firebase Configuration ────────────────────────────────────────
#define FIREBASE_HOST "your-project-id-default-rtdb.firebaseio.com"

// ── Backend Authentication ────────────────────────────────────────
// The backend URL where the ESP32 will fetch its Firebase Custom Token
#define BACKEND_URL "http://YOUR_BACKEND_IP:4000" 
// Or your deployed URL: "https://your-backend.onrender.com"

// The secret for this specific device, verified by the backend
#define DEVICE_SECRET "YOUR_DEVICE_SECRET"
