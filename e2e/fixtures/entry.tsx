import { createRoot } from "react-dom/client";
import { useState } from "react";
import PassengerLayout from "@/app/passenger/layout";
import PassengerWorkspace from "@/components/passenger/PassengerWorkspace";
import SettingsPanel from "@/components/admin/SettingsPanel";
import AdminPage from "@/app/admin/page";
import { setScenario, useScenario } from "./state";
import "../../frontend/src/app/globals.css";
const params = new URLSearchParams(window.location.search);
function Fixture() {
  const scenario = useScenario();
  const [surface, setSurface] = useState(params.get("view") || "passenger");
  // The admin shell's own tab bar sits where these controls float, so admin runs are URL driven.
  return <>{surface !== "admin" && <aside style={{ position: "fixed", top: 0, left: 0, zIndex: 2000, background: "#fff", color: "#000", padding: 8, maxWidth: "100%" }} aria-label="QA fixture controls"><details><summary>QA controls (synthetic)</summary>
    <label>View <select aria-label="QA view" value={surface} onChange={e => setSurface(e.target.value)}><option>passenger</option><option>settings</option></select></label>
    <label>Scenario <select aria-label="QA scenario" value={scenario} onChange={e => setScenario(e.target.value)}>{["pending", "reconnecting", "stale", "offline", "forward", "reverse", "multiple", "multiple-stale", "mixed", "two-routes", "projection-unready", "catalog-denied", "detail-denied", "device", "empty", "completed"].map(value => <option key={value}>{value}</option>)}</select></label>
    <span> Isolated synthetic data; no Firebase connection</span>
  </details></aside>}{surface === "passenger" ? <PassengerLayout><PassengerWorkspace /></PassengerLayout>
    : surface === "admin" ? <AdminPage /> : <div style={{ paddingTop: 80 }}><SettingsPanel /></div>}</>;
}
const initialScenario = params.get("scenario");
if (initialScenario) setScenario(initialScenario);
createRoot(document.getElementById("root")!).render(<Fixture />);
