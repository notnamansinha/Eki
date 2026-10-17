import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveBusMarkerPosition } from "@/hooks/useLiveBusMarkerPosition";
import { useSmoothPosition } from "@/hooks/useSmoothPosition";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";

const epoch = Date.now();
function sample(seq: number, matched: boolean, version = 4): ActiveBusEntry {
  const lat = 23 + seq * 0.00001, lng = 72.0002;
  return { busId: "synthetic-bus", routeId: "synthetic-route", sessionId: "synthetic-session",
    direction: "forward", routeDirection: "forward", routeVersion: version,
    activeRouteId: "synthetic-route:configured:forward", routeState: "ON_ROUTE",
    lat, lng, timestamp: epoch + seq * 1000, deviceState: "online", motionState: "moving",
    rawLocation: { lat, lng, speed: 20, heading: 0, motionState: "moving", gpsHdop: 2, seq, sampledAt: epoch + seq * 1000 },
    mapMatchSeq: seq, mapMatchSampledAt: epoch + seq * 1000,
    ...(matched ? { matchedLocation: { lat, lng: 72, segmentIndex: 0, segmentFraction: .5,
      alongRouteDistanceM: seq, distanceToRouteM: 20, matchConfidence: .9, seq,
      sampledAt: epoch + seq * 1000, routeVersion: version } } : {}),
  };
}
function Marker({ bus, view }: { bus: ActiveBusEntry; view: string }) {
  const selection = useLiveBusMarkerPosition(bus);
  const position = useSmoothPosition(selection.position);
  return <section aria-label={view} data-testid={view} data-lng={position?.lng} data-decision={selection.decision}
    data-uncertain={selection.uncertain} data-version={selection.routeVersion}>
    <h2>{view}</h2><p>{selection.decision}: {selection.reason}{selection.uncertain ? " (approximate)" : ""}</p>
    <svg viewBox="0 0 500 140" aria-label="Synthetic parallel roads">
      <path d="M140 10V130 M340 10V130" stroke="#cbd5e1" strokeWidth="18" />
      <circle cx={140 + ((position?.lng ?? 72) - 72) * 1_000_000} cy="70" r="12" fill={selection.uncertain ? "#d97706" : "#2563eb"} />
    </svg>
  </section>;
}
function App() {
  const [bus, setBus] = useState(() => sample(1, true));
  return <main><h1>Offline routing marker replay</h1><p>Production selection and animation hooks. Synthetic roads; no map provider.</p>
    <button onClick={() => setBus(sample(2, false))}>Low confidence</button>{" "}
    <button onClick={() => setBus(sample(3, true))}>Reliable match</button>{" "}
    <button onClick={() => setBus(sample(4, true, 3))}>Delayed old revision</button>
    <Marker bus={bus} view="Passenger" /><Marker bus={bus} view="Admin" />
  </main>;
}
document.head.insertAdjacentHTML("beforeend", "<style>body{font:16px system-ui;margin:32px;background:#f8fafc;color:#0f172a}main{max-width:800px;margin:auto}section{display:inline-block;width:48%;margin-top:24px}svg{width:100%;height:180px;background:white}button{padding:12px}</style>");
createRoot(document.getElementById("root")!).render(<App />);
