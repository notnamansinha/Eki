# ESP32 Hardware Module Configuration & ID Naming Conventions

This guide explains the naming conventions for **Bus IDs**, **Route IDs**, and **Device Secrets**, and lists all exact locations to configure when deploying or reassigning an ESP32 hardware tracker.

---

## 1. Naming Conventions

To avoid authorization errors in Firebase Realtime Database (RTDB) and Firestore, adhere to the following ID naming standards:

| Entity | Field Name | Recommended Format | Examples | Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Bus ID** | `BUS_ID` / `deviceId` | Lowercase snake_case | `bus_01`, `bus_02` | Must match `[A-Za-z0-9_-]{1,128}` |
| **Route ID** | `ROUTE_ID` / `routeId` | Lowercase snake_case | `route_01`, `route_shela_ld` | **MUST EXACTLY MATCH** document ID in Firestore `routes/{routeId}` |
| **Driver ID** | `DRIVER_ID` | `hw_device` or `driver_01` | `"hw_device"` | Static fallback identifier for hardware tracking |
| **Device Secret** | `DEVICE_SECRET` | 32+ character random string | `test-secret-32-bytes...` | Verified by backend auth (`/api/devices/auth`) |

> ⚠️ **CRITICAL RULE**: The `ROUTE_ID` configured in the ESP32 firmware **must be identical** to the Route ID created in the Admin Panel (`routes` collection in Firestore). If `ROUTE_ID` in firmware is `route_01`, the route in the database **must also** have ID `route_01`.

---

## 2. Checklist for Adding / Editing an ESP32 Tracker

Each ESP32 hardware module is locked to **1 Bus ID** and **1 Route ID**. When provisioning a new ESP32 or reassigning an existing module to a new bus or route, update the following **3 locations**:

### Step 1: ESP32 Firmware (`hardware/include/secrets.h`)
Edit [hardware/include/secrets.h](file:///c:/Users/Naman%20Sinha/Desktop/Eki/hardware/include/secrets.h):

```cpp
#define BUS_ID        "bus_01"               // Unique device/bus identifier
#define ROUTE_ID      "route_01"             // Exact Route ID from Admin Panel/Firestore
#define DRIVER_ID     "hw_device"            // Hardware tracking mode
#define DEVICE_SECRET "test-secret-32-bytes" // Device auth secret
```
*After changing `secrets.h`, re-flash the ESP32 via PlatformIO:* `pio run --target upload`

---

### Step 2: Firestore Database (`devices` Collection)
Create or update the document in Firestore under `devices/{deviceId}` (e.g. `devices/bus_01`):

```json
{
  "deviceId": "bus_01",
  "routeId": "route_01",
  "secretHash": "<scrypt-hash-of-DEVICE_SECRET>",
  "updatedAt": "2026-07-24T20:00:00Z"
}
```
* **Why**: When the ESP32 boots up, it contacts `POST /api/devices/auth`. The backend checks `devices/{deviceId}` in Firestore to verify the secret hash and retrieve its assigned `routeId` before issuing a scoped token.

---

### Step 3: Admin Panel Route Verification (`routes` Collection)
In the Admin Panel (or Firestore `routes` collection), ensure a route exists whose document ID matches `ROUTE_ID` exactly:

* **Route Document ID**: `route_01` (or `route_shela_ld`)
* **Route Name**: "Shela to LD"

---

## 3. Summary Matrix of File Locations

| File / Location | Purpose | Key Fields to Edit |
| :--- | :--- | :--- |
| [`hardware/include/secrets.h`](file:///c:/Users/Naman%20Sinha/Desktop/Eki/hardware/include/secrets.h) | ESP32 Firmware Config | `BUS_ID`, `ROUTE_ID`, `DEVICE_SECRET` |
| **Firestore** `devices/{deviceId}` | Backend Device Authorization | `deviceId`, `routeId`, `secretHash` |
| **Firestore** `routes/{routeId}` | Admin Panel Route Definition | `id` (must match `ROUTE_ID`) |
| **Firestore** `buses/{busId}` | Fleet Management Record | `id`, `assignedRouteId` |
| `npm run sync-role-claims` | Server-side Claims & RTDB Mirror | Run if reassigning human drivers/buses |

---

## 4. Verification

After updating the IDs and flashing the ESP32:
1. Monitor the ESP32 Serial output (`pio device monitor` at 115200 baud).
2. Look for: `[Auth] Token obtained.` followed by `[Firebase] Ready!`.
3. Open the **Admin Dashboard** or **Passenger App** map—the bus will appear live on the specified route!
