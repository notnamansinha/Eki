# BusTrack GNSS App Workflow

Here is the complete end-to-end workflow of the new GNSS hardware-based tracking system, explained visually.

## 1. Physical Hardware & Data Flow

When the driver turns the bus ignition on, the hardware automatically powers up and takes over the GPS tracking without any driver intervention. The driver app simply acts as a shift controller.

```mermaid
sequenceDiagram
    participant B as Bus Ignition (12V)
    participant E as ESP32 Hardware
    participant N as NEO-M8N GPS
    participant R as Firebase RTDB
    participant D as Driver App (Phone)
    participant P as Passenger App

    %% Boot Sequence
    Note over B,E: 1. Power On & Boot
    B->>E: Supplies 12V→5V Power
    E->>E: Boots up (2 seconds)
    E->>E: Connects to Bus WiFi (3-5s)
    E->>R: Authenticates with Firebase
    
    %% GPS Acquisition
    Note over E,N: 2. Satellite Fix
    E->>N: Powers on GNSS Module
    N-->>E: Streams NMEA sentences via UART
    E->>E: Waits for valid GPS fix (Sats > 3)

    %% Shift Start
    Note over D,R: 3. Shift Initialization
    D->>D: Driver selects Bus & Route
    D->>R: Clicks "Start Tracking" -> Writes {status: "active", driverId}
    D->>R: Subscribes to /activeBuses (Read-only)

    %% Tracking Loop
    Note over E,R: 4. Smart Transmission Loop (Every 1s)
    loop Continuous Tracking
        N-->>E: Live lat/lng/speed
        alt Moved >10m OR Turned >15° OR Speed >5km/h
            E->>R: PATCH /activeBuses (lat, lng, speed, heading)
        else Stationary for 30s
            E->>R: PATCH /activeBuses (Heartbeat)
        end
    end

    %% Passenger View
    Note over R,P: 5. Real-time Rendering
    R-->>P: Pushes location delta to passenger maps (<500ms latency)
    R-->>D: Pushes location delta to driver map

    %% Shift End
    Note over B,D: 6. Shift End & Shutdown
    D->>R: Clicks "Stop Tracking" -> Sets {status: "offline"}
    B->>E: Ignition OFF -> Power cut
    E-xR: Connection drops
```

## 2. Smart Transmission State Machine

The biggest cost-saver in the new architecture is the ESP32's Smart Transmission logic. It evaluates the physical movement of the bus to decide whether sending data to Firebase is necessary.

```mermaid
stateDiagram-v2
    [*] --> Init
    
    Init --> WaitingForFix: WiFi Connected
    WaitingForFix --> AcquiredFix: Satellites > 3
    
    AcquiredFix --> CheckMovement: Every 1 Second
    
    state CheckMovement {
        direction LR
        Moved10m --> SendUpdate
        Turned15Deg --> SendUpdate
        SpeedChanged --> SendUpdate
        Stationary30s --> SendUpdate
        NoSignificantChange --> SkipWrite
    }
    
    SendUpdate --> FirebaseRTDB
    SkipWrite --> CheckMovement
    FirebaseRTDB --> CheckMovement
    
    CheckMovement --> WiFiBuffer: WiFi Drops
    WiFiBuffer --> FirebaseRTDB: WiFi Reconnects
```

## Step-by-Step Breakdown

1. **Ignition & Power**: The moment the driver turns the bus key, the 12V cigarette lighter powers the USB adapter, booting the ESP32.
2. **Connectivity**: The ESP32 connects to the onboard bus WiFi and authenticates with Firebase. Simultaneously, the NEO-M8N searches for satellites.
3. **Driver Shift Start**: The driver opens their phone, selects their bus/route, and hits "Start Tracking". Since we removed the hybrid mode, this action **does not activate their phone's GPS**. It merely writes the shift metadata (who is driving) to Firebase and waits.
4. **Smart Telemetry**: As the bus drives, the ESP32 parses NMEA data. If the bus moves in a straight line on a highway, it sends updates only every ~100 meters. If it takes a sharp turn, it immediately sends a packet so the map marker follows the corner smoothly. If it stops at a red light, it falls silent, sending only one "heartbeat" ping every 30 seconds to prove it's still online.
5. **Display**: The Firebase Realtime Database instantly pushes these hardware-generated updates to every passenger's phone, and back to the driver's phone, which renders the position on the screen.
