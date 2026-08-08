"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { RouteData } from "@/hooks/useRoutes";
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

type JoinState = "idle" | "joining" | "joined" | "error";

const formatStopName = (name: string) => {
  const parts = name.split(/[ ,-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return name;
};

/** Resolves the browser location once; rejects if unavailable/denied. */
function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("geolocation-unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 },
    );
  });
}

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
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [joinError, setJoinError] = useState("");
  const pendingRef = useRef<number>(0);

  const joinRide = useCallback(async (boardingStopId: string, alightingStopId: string) => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl) {
      setJoinState("error");
      setJoinError("Ride service is not configured.");
      return;
    }
    if (!userId || userId === "anonymous") {
      setJoinState("error");
      setJoinError("Sign in is required to board.");
      return;
    }

    const attempt = ++pendingRef.current;
    setJoinState("joining");
    setJoinError("");

    let position: { lat: number; lng: number };
    try {
      position = await getCurrentPosition();
    } catch {
      if (attempt === pendingRef.current) {
        setJoinState("error");
        setJoinError("Location access is required to board this bus.");
      }
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/sessions/${sessionId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: position.lat,
          lng: position.lng,
          boardingStopId,
          alightingStopId: alightingStopId || null,
          userName,
        }),
      });
      const result = (await response.json()) as { joined?: boolean; error?: string };
      if (!response.ok || !result.joined) {
        throw new Error(result.error || "Unable to board.");
      }
      if (attempt === pendingRef.current) {
        setJoinState("joined");
      }
    } catch (err: unknown) {
      if (attempt === pendingRef.current) {
        setJoinState("error");
        setJoinError(errorMessage(err));
      }
    }
  }, [sessionId, userId, userName]);

  // Auto join when the rider has chosen a stop. Selection changes re-issue the
  // join so the manifest entry stays in sync with the chosen stops.
  useEffect(() => {
    if (!hasSelectedRideStop(boardingStopId, alightingStopId)) return;
    void joinRide(boardingStopId, alightingStopId);
  }, [boardingStopId, alightingStopId, joinRide]);

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

      {joinState === "joining" && (
        <p className="text-[11px] font-semibold animate-pulse" style={{ color: "var(--status-warning)" }} role="status">
          Confirming you are at the bus…
        </p>
      )}
      {joinState === "joined" && (
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--status-live)" }} role="status">
          On board
        </p>
      )}
      {joinState === "error" && (
        <p className="text-[11px]" style={{ color: "var(--status-danger)" }} role="alert">
          {joinError}
        </p>
      )}
    </div>
  );
}
