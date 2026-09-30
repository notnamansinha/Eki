import "dotenv/config";
import { startTelemetry } from "./instrumentation";

// Dynamic import is intentional: instrumentations must patch dependencies
// before server.ts loads Express, Firebase, HTTP clients, and worker modules.
startTelemetry();
void import("./lib/logger")
  .then(({ installConsoleBridge }) => installConsoleBridge())
  .then(() => import("./server"));
