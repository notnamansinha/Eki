import { createRoot } from "react-dom/client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { useCollection } from "@/hooks/useCollection";
import { useRTDBResume } from "@/hooks/useRTDBResume";
import { useActiveBuses } from "@/hooks/useActiveBuses";
import RoleGuard from "@/components/shared/RoleGuard";
import TelemetryTraceControls from "@/components/TelemetryTraceControls";
import FeedbackPanel from "@/components/admin/FeedbackPanel";
import DashboardPanel from "@/components/admin/DashboardPanel";
import { useLiveRouteCatalog } from "@/hooks/useLiveRouteCatalog";
import { subscribeLiveBusesByRoute } from "@/lib/liveBusStore";
import { passengerTripStates } from "@/lib/passengerLiveBus";
import { passengerBusAvailabilities } from "@/lib/passengerBusAvailability";
import HomePage from "@/app/page";
import { approveVerification, publishPreview, publishAutomaticReturn, rejectVerification, rejectNetworkVerification, reverifyAccount, switchAccount, signOut, tokenWaiting, subscribeTokenWaiting, socketStats, subscribeSocketStats } from "./firebase";
import { finishRestorationAsAdmin, finishRestorationAsPassenger, finishRestorationSignedOut, restorationPending, subscribeRestoration } from "./firebase";
import "../../frontend/src/app/globals.css";
function Metadata() {
  const buses = useCollection<{ name: string }>("buses");
  const routes = useCollection<{ name: string }>("routes");
  return <main>
    <h1>Fleet and routes</h1>
    {buses.error && <p role="alert">{buses.error}</p>}
    {routes.error && <p role="alert">{routes.error}</p>}
    <button onClick={() => { buses.retry(); routes.retry(); }}>Retry fleet access</button>
    {[...buses.data, ...routes.data].map(item => <p key={item.name}>{item.name}</p>)}
  </main>;
}
function Resume() {
  const resume = useRTDBResume();
  const buses = useActiveBuses(resume);
  const stats = useSyncExternalStore(subscribeSocketStats, socketStats);
  return <main>
    <h1>Realtime recovery</h1>
    <output aria-label="Connection state">{resume.isResuming ? "Recovering" : "Ready"}</output>
    <output aria-label="Socket stats">{stats}</output>
    {buses.map(bus => <p key={bus.busId}>Live {bus.busId}</p>)}
  </main>;
}
function RouteProjection() {
  const { catalog } = useLiveRouteCatalog();
  const [snapshot, setSnapshot] = useState<Record<string, Record<string, unknown>> | null>(null);
  useEffect(() => subscribeLiveBusesByRoute("qa-route", setSnapshot), []);
  const states = passengerTripStates(snapshot);
  return <main>
    <h1>Route projection</h1>
    <button onClick={publishPreview}>Publish preview</button>
    <button onClick={publishAutomaticReturn}>Publish automatic return</button>
    <output aria-label="Preview count">{passengerBusAvailabilities(snapshot).length}</output>
    <output aria-label="Catalog preview count">{catalog["qa-route"]?.available ?? 0}</output>
    <output aria-label="Joined session state">{states.get("joined") ?? "unknown"}</output>
  </main>;
}
// `?restoreHang`: finish the held cold-open restoration with a chosen outcome.
function RestorationControls() {
  const pending = useSyncExternalStore(subscribeRestoration, restorationPending);
  return <>
    <button disabled={!pending} onClick={finishRestorationSignedOut}>Finish restoration as signed out</button>{" "}
    <button disabled={!pending} onClick={finishRestorationAsPassenger}>Finish restoration as passenger</button>{" "}
    <button disabled={!pending} onClick={finishRestorationAsAdmin}>Finish restoration as admin</button>
  </>;
}
function Fixture() {
  const waiting = useSyncExternalStore(subscribeTokenWaiting, tokenWaiting);
  const query = new URLSearchParams(location.search);
  return <>
  <aside aria-label="Synthetic verification controls" style={{ position: "fixed", top: 0, zIndex: 2000, background: "white", color: "black", padding: 8 }}>
    <button disabled={!waiting} onClick={approveVerification}>Approve verification</button>{" "}
    <button disabled={!waiting} onClick={rejectVerification}>Reject verification</button>{" "}
    {new URLSearchParams(location.search).has("recovery") && <button disabled={!waiting} onClick={rejectNetworkVerification}>Reject network verification</button>}{" "}
    <button onClick={switchAccount}>Switch account</button>{" "}
    <button onClick={reverifyAccount}>Reverify account</button>{" "}
    <button onClick={() => void signOut()}>Synthetic sign out</button>
    {query.has("restoreHang") && <>{" "}<RestorationControls /></>}
  </aside>
  {/* `?landing` mounts the actual landing page instead of a protected route. */}
  <AuthProvider><TelemetryTraceControls />{query.has("landing") ? <HomePage /> : new URLSearchParams(location.search).has("traceExport") ? <main style={{ paddingTop: 65 }}><h1>Local trace fixture</h1></main> : <RoleGuard allowedRoles={["admin"]}><div style={{ paddingTop: new URLSearchParams(location.search).has("recovery") ? 110 : 65, ...(new URLSearchParams(location.search).has("dashboard") ? { height: "100dvh", boxSizing: "border-box" as const } : {}) }}>
    {new URLSearchParams(location.search).has("dashboard") ? <DashboardPanel /> : new URLSearchParams(location.search).has("projection") ? <RouteProjection /> : new URLSearchParams(location.search).has("resume") ? <Resume /> : new URLSearchParams(location.search).has("metadata") ? <Metadata /> : <FeedbackPanel embedded={new URLSearchParams(location.search).has("embedded")} />}
  </div></RoleGuard>}</AuthProvider>
</>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
