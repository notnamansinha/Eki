import { createRoot } from "react-dom/client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { useCollection } from "@/hooks/useCollection";
import { useRTDBResume } from "@/hooks/useRTDBResume";
import { useActiveBuses } from "@/hooks/useActiveBuses";
import RoleGuard from "@/components/shared/RoleGuard";
import FeedbackPanel from "@/components/admin/FeedbackPanel";
import { useLiveRouteCatalog } from "@/hooks/useLiveRouteCatalog";
import { subscribeLiveBusesByRoute } from "@/lib/liveBusStore";
import { passengerTripStates } from "@/lib/passengerLiveBus";
import { passengerBusAvailabilities } from "@/lib/passengerBusAvailability";
import { approveVerification, publishPreview, publishAutomaticReturn, rejectVerification, reverifyAccount, switchAccount, signOut, tokenWaiting, subscribeTokenWaiting, socketStats, subscribeSocketStats } from "./firebase";
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
function Fixture() {
  const waiting = useSyncExternalStore(subscribeTokenWaiting, tokenWaiting);
  return <>
  <aside aria-label="Synthetic verification controls" style={{ position: "fixed", top: 0, zIndex: 2000, background: "white", color: "black", padding: 8 }}>
    <button disabled={!waiting} onClick={approveVerification}>Approve verification</button>{" "}
    <button disabled={!waiting} onClick={rejectVerification}>Reject verification</button>{" "}
    <button onClick={switchAccount}>Switch account</button>{" "}
    <button onClick={reverifyAccount}>Reverify account</button>{" "}
    <button onClick={() => void signOut()}>Synthetic sign out</button>
  </aside>
  <AuthProvider><RoleGuard allowedRoles={["admin"]}><div style={{ paddingTop: 65 }}>
    {new URLSearchParams(location.search).has("projection") ? <RouteProjection /> : new URLSearchParams(location.search).has("resume") ? <Resume /> : new URLSearchParams(location.search).has("metadata") ? <Metadata /> : <FeedbackPanel embedded={new URLSearchParams(location.search).has("embedded")} />}
  </div></RoleGuard></AuthProvider>
</>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
