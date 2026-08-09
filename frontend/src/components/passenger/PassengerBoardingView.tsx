"use client";

import { useState } from "react";
import { RouteData } from "@/hooks/useRoutes";
import CustomSelect from "@/components/ui/CustomSelect";
import { errorMessage } from "@/lib/errors";
import { auth } from "@/lib/firebaseAuth";

interface Props {
  sessionId: string;
  route: RouteData;
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

function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location services are unavailable."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      () => reject(new Error("Location access is required to board this bus.")),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
    );
  });
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8);
}

export default function PassengerBoardingView({
  sessionId,
  route,
  tripState,
  onBoardingStopChange,
  onStopSelected,
}: Props) {
  const [boardingStopId, setBoardingStopId] = useState("");
  const [alightingStopId, setAlightingStopId] = useState("");
  const [boardingCode, setBoardingCode] = useState("");
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [joinError, setJoinError] = useState("");

  const stopOptions = (route.stops ?? []).map((stop) => ({
    value: stop.id,
    label: formatStopName(stop.name),
  }));

  const joinRide = async () => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    const currentUser = auth.currentUser;
    if (!backendUrl) {
      setJoinState("error");
      setJoinError("Ride service is not configured.");
      return;
    }
    if (!currentUser) {
      setJoinState("error");
      setJoinError("Sign in is required to board.");
      return;
    }
    if (!boardingStopId || boardingCode.length !== 8) {
      setJoinState("error");
      setJoinError("Choose a boarding stop and enter the 8-character code from the driver.");
      return;
    }

    setJoinState("joining");
    setJoinError("");
    try {
      const [position, token] = await Promise.all([
        getCurrentPosition(),
        currentUser.getIdToken(),
      ]);
      const response = await fetch(`${backendUrl}/api/sessions/${sessionId}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...position,
          boardingCode,
          boardingStopId,
          alightingStopId: alightingStopId || null,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json().catch(() => ({})) as {
        joined?: boolean;
        error?: string;
      };
      if (!response.ok || result.joined !== true) {
        throw new Error(result.error || "Unable to board.");
      }
      setJoinState("joined");
      onStopSelected?.(true);
    } catch (error) {
      setJoinState("error");
      setJoinError(errorMessage(error));
    }
  };

  const selectionChanged = () => {
    if (joinState === "joined" || joinState === "error") setJoinState("idle");
    setJoinError("");
  };

  return (
    <div className="flex w-full flex-col gap-2 animate-fade-in pointer-events-auto">
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
        onChange={(value) => {
          setBoardingStopId(value);
          onBoardingStopChange?.(value);
          selectionChanged();
        }}
        options={[{ value: "", label: "Boarding..." }, ...stopOptions]}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
      />
      <CustomSelect
        ariaLabel="Destination stop"
        placeholder="Destination (Optional)..."
        value={alightingStopId}
        onChange={(value) => {
          setAlightingStopId(value);
          selectionChanged();
        }}
        options={[{ value: "", label: "Destination (Optional)..." }, ...stopOptions]}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
      />
      <div className="flex gap-2">
        <input
          value={boardingCode}
          onChange={(event) => {
            setBoardingCode(normalizeCode(event.target.value));
            selectionChanged();
          }}
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-bold uppercase tracking-[0.18em] outline-none"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
          aria-label="Boarding code"
          placeholder="DRIVER CODE"
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={8}
        />
        <button
          type="button"
          onClick={() => void joinRide()}
          disabled={joinState === "joining" || !boardingStopId || boardingCode.length !== 8}
          className="rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--status-live)", color: "var(--surface-0)" }}
        >
          {joinState === "joining" ? "Checking…" : joinState === "joined" ? "On board" : "Board"}
        </button>
      </div>
      {joinState === "joining" && (
        <p className="text-[11px] font-semibold" style={{ color: "var(--status-warning)" }} role="status">
          Verifying the session code and live bus position…
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
