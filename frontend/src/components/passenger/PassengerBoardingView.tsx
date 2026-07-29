"use client";

import { useState, useEffect, useRef } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RouteData } from "@/hooks/useRoutes";
import { ChevronDown } from "lucide-react";
import { errorMessage } from "@/lib/errors";

interface Props {
  sessionId: string;
  route: RouteData;
  userId: string;
  userName: string;
  tripState: "pre_departure" | "in_service";
  onBoardingStopChange?: (stopId: string) => void;
}

const formatStopName = (name: string) => {
  const parts = name.split(/[ ,-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return name;
};

export default function PassengerBoardingView({ sessionId, route, userId, userName, tripState, onBoardingStopChange }: Props) {
  const [boardingStopId, setBoardingStopId] = useState<string>("");
  const [alightingStopId, setAlightingStopId] = useState<string>("");

  const isMounted = useRef(false);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    
    // Auto sync when selection changes
    if (!boardingStopId) return;

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

  return (
    <div className="flex flex-col w-full animate-fade-in pointer-events-auto gap-2">
      <p
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: tripState === "in_service" ? "var(--status-live)" : "var(--status-warning)" }}
        role="status"
      >
        {tripState === "in_service" ? "Ride in service" : "Ride armed · awaiting stop 1"}
      </p>
      <div className="relative w-full">
        <select
          aria-label="Boarding stop"
          value={boardingStopId}
          onChange={(e) => {
            setBoardingStopId(e.target.value);
            onBoardingStopChange?.(e.target.value);
          }}
          className="w-full h-11 rounded-xl pl-4 pr-10 text-[13px] font-semibold focus:outline-none appearance-none transition-all truncate shadow-sm m-0"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
        >
          <option value="">Boarding...</option>
          {route.stops?.map(stop => (
            <option key={stop.id} value={stop.id}>{formatStopName(stop.name)}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-ghost)" }} />
      </div>
      <div className="relative w-full">
        <select
          aria-label="Destination stop"
          value={alightingStopId}
          onChange={(e) => setAlightingStopId(e.target.value)}
          className="w-full h-11 rounded-xl pl-4 pr-10 text-[13px] font-semibold focus:outline-none appearance-none transition-all truncate shadow-sm m-0"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
        >
          <option value="">Destination (Optional)...</option>
          {route.stops?.map(stop => (
            <option key={stop.id} value={stop.id}>{formatStopName(stop.name)}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-ghost)" }} />
      </div>
    </div>
  );
}
