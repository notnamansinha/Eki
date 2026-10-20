import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import PassengerWorkspace from "@/components/passenger/PassengerWorkspace";
import RouteManagementPanel from "@/components/admin/RouteManagementPanel";
import RideHistoryPanel from "@/components/admin/RideHistoryPanel";
import { advanceMotion, setScenario, useScenario } from "./state";
import "../../frontend/src/app/globals.css";
function Fixture() {
  const [surface, setSurface] = useState("passenger");
  const scenario = useScenario();
  useEffect(() => { window.addEventListener("qa-motion", advanceMotion); return () => window.removeEventListener("qa-motion", advanceMotion); }, []);
  return <><aside className="fixed right-0 bottom-0 z-[2000] max-w-full bg-white text-black" aria-label="Synthetic audit controls"><details><summary>QA controls</summary>
    <label>View <select aria-label="QA view" value={surface} onChange={e => setSurface(e.target.value)}><option>passenger</option><option>routes</option><option>history</option></select></label>
    <label>Scenario <select aria-label="QA scenario" value={scenario} onChange={e => setScenario(e.target.value)}>{["forward", "pending", "device", "empty"].map(value => <option key={value}>{value}</option>)}</select></label>
    <button type="button" onClick={advanceMotion}>Publish moving update</button>
    <p>Synthetic boundaries; no cloud, provider or hardware</p>
  </details></aside>{surface === "passenger" ? <PassengerWorkspace /> : <main className="h-dvh bg-brand-dark">{surface === "routes" ? <RouteManagementPanel /> : <RideHistoryPanel />}</main>}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
