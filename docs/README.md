# Eki Documentation

Welcome to the deep-dive documentation for the Eki ecosystem.

## Documentation Index

- [Master Project Scrum Board](./SCRUM_BOARD.md) — Comprehensive master Scrum Board breaking down all Epics, Sprints, User Stories, Tasks, Priorities, Estimates, and Acceptance Criteria.
- [Architecture & Data Flow](./ARCHITECTURE.md) — Explains the core system architecture, data synchronization flows between Firebase and the backend, and Role-Based Access Control (RBAC).
- [Zero-Budget Optimizations](./OPTIMIZATIONS.md) — Detailed breakdown of cost-saving architectural strategies including ESP32 telemetry limits and stored route geometry.
- [GNSS Hardware Migration](./GNSS_HARDWARE_MIGRATION.md) — Comprehensive guide on migrating from browser-based geolocation to the dedicated ESP32 + NEO-M8N GNSS module.
- [Workflow Explanation](./WORKFLOW_EXPLANATION.md) — Visual workflows of the end-to-end hardware-based tracking system, including hardware boot sequences and ETA calculation pipelines.
- [Google Maps Recovery](./GOOGLE_MAPS_RECOVERY.md) — Historical notes on the migration back to Google Maps.

## Sub-project Documentation

For specific setup and execution instructions for the individual components of the stack, refer to their respective READMEs:

- [Frontend Workspace](../frontend/README.md)
- [Backend Workspace](../backend/README.md)
- [Hardware Workspace](../hardware/README.md)
