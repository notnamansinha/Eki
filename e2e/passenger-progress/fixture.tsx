import { createRoot } from "react-dom/client";
import { useState } from "react";
import PassengerMap from "@/components/maps/PassengerMap";
import PassengerBoardingView from "@/components/passenger/PassengerBoardingView";
import PassengerWorkspace from "@/components/passenger/PassengerWorkspace";
import type { PassengerStopEstimates } from "@/lib/passengerStopEstimates";
import { publish, publishArrival, publishDeparture, publishDetour, publishUncertainFix, route } from "./state";
import "../../frontend/src/app/globals.css";

function Fixture() {
  const [estimates, setEstimates] = useState<PassengerStopEstimates>();
  const query = new URLSearchParams(window.location.search);
  if (query.has("workspace")) return <>
    <div style={{ position: "fixed", top: 0, left: 0, zIndex: 100, background: "#09090b", color: "white" }}>
      <button onClick={publishDeparture}>Replay credible departure</button>
      <button onClick={() => publishArrival(2.6)}>Fix outside arrival circle</button>
      <button onClick={() => publishArrival(2.4)}>Fix inside arrival circle</button>
    </div>
    <PassengerWorkspace />
  </>;
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
