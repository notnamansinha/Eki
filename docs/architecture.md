# BusTrack Architecture & Data Flow

This document details the core architecture, data synchronization flows, and Role-Based Access Control (RBAC) hierarchy of the BusTrack ecosystem.

## 1. High-Level Architecture

BusTrack uses a modern hybrid, real-time architecture leveraging Firebase as the core streaming layer and a containerized Node.js backend for heavy computation. 

```mermaid
graph TD
    subgraph Frontend [Next.js Client Applications]
        P["Passenger App<br/>(Reads Live Data)"]
        D["Driver Console<br/>(Writes Live Data)"]
        A["Admin Dashboard<br/>(Full Access)"]
    end

    subgraph Firebase Ecosystem
        Auth[Firebase Auth Base]
        RTDB[("Realtime Database<br/>High-Frequency GPS")]
        FS[("Firestore<br/>Persistent Data/Roles")]
        Hosting["Firebase Hosting<br/>Static CDN"]
    end

    subgraph Cloud Container [Backend Server - Cloud Run/Render]
        Express[Node.js + Express]
        SocketIO[Socket.io Gateway]
        RoutesAPI["Google Maps<br/>Routes API v2"]
    end

    %% Web connections
    Hosting -.->|Delivers Static Built App| Frontend
    Frontend -->|Authenticates| Auth
    Auth -->|Returns Token| Frontend
    
    %% Realtime Connections
    D -->|Push GPS| RTDB
    RTDB -->|Listen Updates| P
    A -->|Listen and Override| RTDB
    RTDB -->|Listen and Override| A

    %% Backend Connections
    Frontend -->|REST and WS| Express
    Express -->|REST and WS| Frontend
    Express -->|Validates/Updates| FS
    Express -->|Computes Polylines| RoutesAPI
```

## 2. Role-Based Access Control (RBAC) Flow

The system employs a strict hierarchical Role-Based Access Control pattern. The `RoleGuard` wrapper checks a user's role initialized via Google Authentication against the page's permitted roles. 

### Role Hierarchy
* **Admin:** Inherits all permissions. Can view `/admin`, `/driver`, and `/passenger`.
* **Driver:** Can view `/driver` and `/passenger`.
* **Passenger:** Can only view `/passenger`.

```mermaid
sequenceDiagram
    participant User
    participant RoleGuard
    participant Firebase Auth
    participant Firestore
    participant Protected Page

    User->>RoleGuard: Requests Route (e.g., /driver)
    RoleGuard->>Firebase Auth: Check Auth State
    
    alt is authenticated
        Firebase Auth-->>RoleGuard: Returns User ID
        RoleGuard->>Firestore: Fetch User Role Document
        Firestore-->>RoleGuard: Returns Role (e.g., 'admin')
        
        Note over RoleGuard: Array Check:<br>['driver', 'admin'].includes('admin')
        
        alt Role matches allowed roles
            RoleGuard->>Protected Page: Render Children
            Protected Page-->>User: Displays Dashboard
        else Role NOT in allowed roles
            RoleGuard-->>User: Renders 403 Access Restricted
        end
    else Not authenticated
        RoleGuard-->>User: Renders Login Prompt
    end
```

## 3. Real-Time GPS Tracking Data Flow

Location updates happen completely outside the standard Node.js server. The Drivers stream directly to the Firebase Realtime Database (RTDB), which in turn publishes the updates to the Passenger app, ensuring sub-second latency globally.

```mermaid
graph LR
    subgraph Client [Driver App]
        GPS1[Browser Geolocation API]
        GPS1 -->|1. Emits coords every 5s| DBClient[Frontend Firebase SDK]
    end

    subgraph Firebase [Google Cloud]
        RTDB[( Firebase Realtime Database )]
    end

    subgraph Subscribers [Listeners]
        PApp[Passenger Live Map]
        AApp[Admin Fleet Map]
    end

    DBClient -->|2. HTTP Upgrade/WebSocket| RTDB
    
    RTDB -->|3. Data Sync Stream| PApp
    RTDB -->|3. Data Sync Stream| AApp

    style RTDB fill:#ffca28,stroke:#f57f17,stroke-width:2px,color:black
```

## 4. Auth Fallback & Loading Cycle

As implemented in `RoleGuard`, to prevent infinite loading screens when Firestore latency issues occur or network connections drop:

```mermaid
stateDiagram-v2
    [*] --> Authenticating: Page Load
    Authenticating --> VerifyingAuth: Auth State Changed
    VerifyingAuth --> FetchedRole: Firebase Responds < 6s
    VerifyingAuth --> TimeoutFallback: > 6s Elapsed
    
    FetchedRole --> Allowed: Role Valid
    FetchedRole --> Denied: Role Invalid
    
    TimeoutFallback --> Denied: Show "Access Restricted"
    
    Allowed --> [*]: Render Context
    Denied --> [*]: Render Error & Prompt Login
```

## 5. Backend Dockerization

The Node.js backend (located in the `/backend` directory) includes a `Dockerfile` and `.dockerignore`. While Firebase (RTDB & Firestore) efficiently handles direct client-to-database real-time streaming, the Dockerized Node.js backend exists to securely manage operations that cannot be handled directly from the client:

* **Heavy Computation:** Interacting with the Google Maps Routes API v2 to compute complex polylines and ETAs.
* **Security & Validation:** Hiding sensitive Server API keys and enforcing complex business logic or data validation before updating Firestore.
* **WebSocket Management:** Running a Socket.io gateway for advanced client-server communications.

The `Dockerfile` packages this Express server into an isolated container. This allows the backend to be deployed anywhere that supports containers (like **Google Cloud Run** or **Render**), ensuring it scales automatically and runs consistently across development, staging, and production environments.
