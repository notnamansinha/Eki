import { createRoot } from "react-dom/client";
import { useState } from "react";
import PassengerMap from "@/components/maps/PassengerMap";
import PassengerBoardingView from "@/components/passenger/PassengerBoardingView";
import PassengerWorkspace from "@/components/passenger/PassengerWorkspace";
import type { PassengerStopEstimates } from "@/lib/passengerStopEstimates";
import { publish, publishArrival, publishArrivalAtNextStop, publishAtOrigin, publishDeparture, publishDetour, publishGnssLoss, publishUncertainFix, route } from "./state";
import { STOP_ARRIVAL_GEOFENCE_M } from "../../backend/src/services/tripStateReducer";
import "../../frontend/src/app/globals.css";

function Fixture() {
  const [estimates, setEstimates] = useState<PassengerStopEstimates>();
  const query = new URLSearchParams(window.location.search);
  // Harness controls sit above the workspace, never over it: wider CI fonts wrap
  // them onto more lines, and an overlay then intercepts clicks on the app header.
  // The transform makes the workspace's fixed overlays stay inside its own box,
  // and this fixture alone fits the workspace (100dvh by default) to that box so
  // its bottom navigation is not clipped.
  if (query.has("workspace")) return <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#09090b" }}>
    <style>{"[data-passenger-workspace] { height: 100% !important; }"}</style>
    <div data-harness-controls style={{ flex: "none", display: "flex", flexWrap: "wrap", gap: 4, color: "white" }}>
      <button onClick={publishDeparture}>Replay credible departure</button>
      <button onClick={() => publishArrival(STOP_ARRIVAL_GEOFENCE_M + 0.1)}>Fix outside arrival corridor</button>
      <button onClick={() => publishArrival(STOP_ARRIVAL_GEOFENCE_M - 0.1)}>Fix inside arrival corridor</button>
      <button onClick={publishAtOrigin}>Publish at origin</button>
      <button onClick={publishArrivalAtNextStop}>Arrive at next stop</button>
      <button onClick={publishGnssLoss}>Publish GNSS loss</button>
      <button onClick={() => publish(2)}>Publish fresh fix</button>
    </div>
    <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", transform: "translateZ(0)" }}>
      <PassengerWorkspace />
    </div>
  </div>;
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#09090b", color: "white" }}>
    <header style={{ padding: 16, position: "relative", zIndex: 50 }}>
      <p>Synthetic GPS regression · actual passenger components</p>
      <PassengerBoardingView sessionId="synthetic-session" route={route} tripState="in_service" stopEstimates={estimates} />
      <button onClick={() => publish(3)}>Publish next stop</button>
      <button onClick={() => publish(2)}>Publish fresh fix</button>
      <button onClick={() => publishDetour()}>Publish detour</button>
      <button onClick={() => publishDetour(false)}>Publish pending detour</button>
      <button onClick={publishUncertainFix}>Publish uncertain fix</button>
    </header>
    <div style={{ position: "relative", zIndex: 0, flex: 1, minHeight: 0 }}>
      <PassengerMap route={route} targetStop={route.stops[3]} selectedBusKey="session:synthetic-session" onStopEstimatesChange={setEstimates} />
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
