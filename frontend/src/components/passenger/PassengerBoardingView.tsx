"use client";
"use client";

import { useState, useEffect } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { RouteData } from "@/hooks/useRoutes";
import { ChevronDown } from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";
import { errorMessage } from "@/lib/errors";
import { hasSelectedRideStop } from "@/lib/rideFeedbackEligibility";

interface Props {
  sessionId: string;
  route: RouteData;
  userId: string;
  userName: string;
  tripState: "pre_departure" | "in_service";
  onBoardingStopChange?: (stopId: string) => void;
  onStopSelected?: (hasSelectedStop: boolean) => void;
}

const formatStopName = (name: string) => {
  const parts = name.split(/[ ,-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return name;
};

export default function PassengerBoardingView({
  sessionId,
  route,
  userId,
  userName,
  tripState,
  onBoardingStopChange,
  onStopSelected,
}: Props) {
  const [boardingStopId, setBoardingStopId] = useState<string>("");
  const [alightingStopId, setAlightingStopId] = useState<string>("");

  useEffect(() => {
    // Auto sync when selection changes
    if (!hasSelectedRideStop(boardingStopId, alightingStopId)) return;

    const syncPassenger = async () => {
      try {
        const sessionRef = doc(db, "ride_sessions", sessionId);
        // The UID-keyed nested update needs no manifest read, keeping other
        // riders' travel data private. Rules permit only this user's entry.
        await updateDoc(sessionRef, {
          [`passengers.${userId}`]: {
            userId,
            userName,
            boardingStopId,
            alightingStopId: alightingStopId || null,
            joinedAt: serverTimestamp(),
          },
        });
      } catch (err: unknown) {
        // CR-06: Differentiate a permission-denied rejection (which may indicate
        // a legacy array-shaped passengers field in an older ride_session document
        // that can't be updated with map-key dot notation) from other errors.
        if (typeof err === "object" && err !== null && "code" in err && err.code === "permission-denied") {
          console.error(
            `[PassengerBoardingView] Boarding sync blocked for session ${sessionId} ` +
            "— possibly a legacy array-shaped passengers manifest. Backend migration required.",
            err
          );
        } else {
          console.error("Failed to sync passenger:", errorMessage(err));
        }
      }
    };

    syncPassenger();
  }, [boardingStopId, alightingStopId, sessionId, userId, userName]);

  const stopOptions = (route.stops ?? []).map((stop) => ({
    value: stop.id,
    label: formatStopName(stop.name),
  }));

  return (
    <div className="flex flex-col w-full animate-fade-in pointer-events-auto gap-2">
      <p
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: tripState === "in_service" ? "var(--status-live)" : "var(--status-warning)" }}
        role="status"
      >
        {tripState === "in_service" ? "Ride in service" : "Ride armed · awaiting stop 1"}
      </p>
      <CustomSelect
        ariaLabel="Boarding stop"
        placeholder="Boarding..."
        value={boardingStopId}
        onChange={(nextBoardingStopId) => {
          setBoardingStopId(nextBoardingStopId);
          onBoardingStopChange?.(nextBoardingStopId);
          onStopSelected?.(hasSelectedRideStop(nextBoardingStopId, alightingStopId));
        }}
        options={[{ value: "", label: "Boarding..." }, ...stopOptions]}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
      />
      <CustomSelect
        ariaLabel="Destination stop"
        placeholder="Destination (Optional)..."
        value={alightingStopId}
        onChange={(nextAlightingStopId) => {
          setAlightingStopId(nextAlightingStopId);
          onStopSelected?.(hasSelectedRideStop(boardingStopId, nextAlightingStopId));
        }}
        options={[{ value: "", label: "Destination (Optional)..." }, ...stopOptions]}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
      />
    </div>
  );
}
