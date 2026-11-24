import { createRoot } from "react-dom/client";
import PassengerLayout from "@/app/passenger/layout";
import PassengerWorkspace from "@/components/passenger/PassengerWorkspace";
import { setScenario } from "../fixtures/state";
import "../../frontend/src/app/globals.css";

// The real passenger layout and workspace. Auth, routes and the live catalog
// are the shared synthetic fixture; the demo ride itself is the production
// simulator. `?scenario=empty` (the default) has no live bus, so Live routes
// shows only the demo ride; `?scenario=forward` adds the QA route's bus.
const params = new URLSearchParams(window.location.search);
setScenario(params.get("scenario") ?? "empty");
createRoot(document.getElementById("root")!).render(<PassengerLayout><PassengerWorkspace /></PassengerLayout>);
