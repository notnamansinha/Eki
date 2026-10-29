"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RouteData } from "@/hooks/useRoutes";
import InAppSelect from "@/components/ui/InAppSelect";
import { errorMessage } from "@/lib/errors";
import { auth } from "@/lib/firebaseAuth";
import { ApiError, apiRequest } from "@/lib/apiClient";
import { withTimeout } from "@/lib/promiseTimeout";
import { getAuthVerificationGeneration } from "@/lib/authState";
import { stopEstimateLabel, type PassengerStopEstimates } from "@/lib/passengerStopEstimates";
import { describeLiveBusHealth, formatUpdateAge, type LiveBusHealth } from "@/lib/liveBusHealth";
import { isBehindBus, stopProgress } from "@/lib/stopProgress";

interface Props {
  sessionId: string;
  route: RouteData;
  tripState: "pre_departure" | "in_service";
  destinationStopId?: string;
  stopEstimates?: PassengerStopEstimates;
  restoredBoarding?: { boardingStopId: string; alightingStopId: string | null };
  /** Location freshness of this bus; lifecycle alone never means "live". */
  liveHealth?: LiveBusHealth;
  /** Boarding needs live tracking; the card stays mounted while it returns. */
  boardingBlockedReason?: string;
  onDestinationStopChange?: (stopId: string) => void;
  onJoined?: () => void;
}

type JoinState = "idle" | "joining" | "joined" | "error";

const formatStopName = (name: string) => {
  const parts = name.split(/[ ,-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return name;
};

const PREPARATION_TIMEOUT_MS = 10_000;
const BOARDING_API_TIMEOUT_MS = 10_000;

function untilCancelled<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(value => {
      signal.removeEventListener("abort", abort); resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

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
      error => reject(new Error(error.code === 1
        ? "Location access is required to board this bus."
        : error.code === 3
          ? "Location acquisition timed out. Please try again."
          : "Location is unavailable. Check your device location settings and try again.")),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: PREPARATION_TIMEOUT_MS },
    );
  });
}

export default function PassengerBoardingView({
  sessionId,
  route,
  tripState,
  destinationStopId,
  stopEstimates,
  restoredBoarding,
  liveHealth,
  boardingBlockedReason,
  onDestinationStopChange,
  onJoined,
}: Props) {
  const [boardingStopId, setBoardingStopId] = useState("");
  const [alightingStopId, setAlightingStopId] = useState(destinationStopId ?? "");
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [joinError, setJoinError] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId);
  const [renderedDestination, setRenderedDestination] = useState(destinationStopId);
  const joinAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef(sessionId);
  // Adjust only the session result when props change. Keep the passenger's
  // draft choices, and never commit a frame showing the previous join.
  if (renderedSessionId !== sessionId) {
    setRenderedSessionId(sessionId);
    setHasJoined(false);
    setJoinState("idle");
    setJoinError("");
  }
  if (renderedDestination !== destinationStopId) {
    setRenderedDestination(destinationStopId);
    if (destinationStopId !== undefined) setAlightingStopId(destinationStopId);
  }

  useLayoutEffect(() => {
    sessionRef.current = sessionId;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      joinAbortRef.current?.abort();
      joinAbortRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!restoredBoarding) return;
    let current = true;
    queueMicrotask(() => {
      if (!current || !mountedRef.current || sessionRef.current !== sessionId) return;
      setBoardingStopId(restoredBoarding.boardingStopId);
      setAlightingStopId(restoredBoarding.alightingStopId ?? "");
      setHasJoined(true);
      setJoinState("joined");
      setJoinError("");
    });
    return () => { current = false; };
  }, [restoredBoarding, sessionId]);

  const progress = stopProgress(route.stops?.length ?? 0, {
    currentStopIndex: stopEstimates?.nextStopIndex,
    atStopIndex: stopEstimates?.atStopIndex,
    unobservedStopIndices: stopEstimates?.unobservedStopIndices,
  });
  const stopOptions = (route.stops ?? []).map((stop, index) => ({
    value: stop.id,
    label: formatStopName(stop.name),
    detail: stopEstimateLabel(stopEstimates, stop.id, index),
    completed: isBehindBus(progress?.states[index]),
  }));
  const atStop = progress?.atStopIndex !== undefined ? route.stops?.[progress.atStopIndex] : undefined;
  const nextStop = progress?.nextStopIndex !== undefined ? route.stops?.[progress.nextStopIndex] : undefined;
  const progressSummary = [atStop ? `At ${atStop.name}` : undefined, nextStop ? `Next: ${nextStop.name}` : undefined]
    .filter(Boolean).join(" · ");
  const delayed = liveHealth?.state === "delayed";
  // Never claim "Live" without a health reading. Lost or offline outranks the
  // pre-departure warning; green only while in service and live.
  const healthDescription = liveHealth ? describeLiveBusHealth(liveHealth) : undefined;
  const statusColor = healthDescription?.tone === "danger" ? "var(--status-danger)"
    : tripState === "in_service" && healthDescription?.tone === "live" ? "var(--status-live)" : "var(--status-warning)";
  const boardHint = joinState === "joining" || joinState === "joined" ? undefined
    : boardingBlockedReason ? boardingBlockedReason
    : !boardingStopId || !alightingStopId ? "Choose your boarding and destination stops to board."
      : boardingStopId === alightingStopId ? "Choose two different stops." : undefined;

  const joinRide = async () => {
    // State updates are batched; a ref closes the same-render double-click gap.
    if (joinAbortRef.current) return;
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
    if (!boardingStopId || !alightingStopId || boardingStopId === alightingStopId) {
      setJoinState("error");
      setJoinError("Choose distinct boarding and destination stations.");
      return;
    }

    setJoinState("joining");
    setJoinError("");
    const updatingExistingPassenger = hasJoined;
    const controller = new AbortController();
    joinAbortRef.current = controller;
    const authGeneration = getAuthVerificationGeneration();
    const isCurrent = () => mountedRef.current &&
      joinAbortRef.current === controller && !controller.signal.aborted &&
      sessionRef.current === sessionId && auth.currentUser === currentUser &&
      getAuthVerificationGeneration() === authGeneration;
    try {
      const [token, position] = await Promise.all([
        withTimeout(untilCancelled(currentUser.getIdToken(), controller.signal), PREPARATION_TIMEOUT_MS, "Sign-in verification timed out. Please try again."),
        updatingExistingPassenger ? Promise.resolve(null) : withTimeout(
          untilCancelled(getCurrentPosition(), controller.signal), PREPARATION_TIMEOUT_MS,
          "Location acquisition timed out. Please try again.",
        ),
      ]);
      if (!isCurrent()) return;
      const result = await apiRequest<{ joined?: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(position ?? {}),
          boardingStopId,
          alightingStopId: alightingStopId || null,
        }),
        signal: controller.signal,
        timeoutMs: BOARDING_API_TIMEOUT_MS,
        fallbackError: "Unable to board.",
      });
      if (!result || result.joined !== true) {
        throw new Error("Unable to board.");
      }
      if (!isCurrent()) return;
      setHasJoined(true);
      setJoinState("joined");
      onJoined?.();
    } catch (error) {
      if (!isCurrent()) return;
      // If the server no longer sees the prior manifest entry, the next attempt
      // must perform the first-boarding proximity check again.
      if (updatingExistingPassenger) setHasJoined(false);
      setJoinState("error");
      setJoinError(
        error instanceof ApiError && error.code === "NETWORK_TIMEOUT"
          ? "The boarding request timed out. Please try again."
          : errorMessage(error),
      );
    } finally {
      // Cancel any other preparation still pending after a failed stage.
      controller.abort();
      if (joinAbortRef.current === controller) joinAbortRef.current = null;
    }
  };

  const selectionChanged = () => {
    if (joinState === "joined" || joinState === "error") setJoinState("idle");
    setJoinError("");
  };

  return (
    <div className="flex w-full flex-col gap-2 animate-fade-in pointer-events-auto">
      <div role="status" aria-live="polite">
        <p
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: statusColor }}
        >
          {tripState === "in_service" ? "Ride in service" : "Ride armed · awaiting stop 1"}
          {healthDescription && ` · ${healthDescription.title}`}
          {delayed && ` · ${formatUpdateAge(liveHealth?.ageMs)}`}
        </p>
        {progressSummary && (
          <p className="mt-0.5 truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{progressSummary}</p>
        )}
      </div>
      <InAppSelect
        name="boarding-stop"
        ariaLabel="Boarding stop"
        placeholder="Choose boarding stop"
        value={boardingStopId}
        disabled={joinState === "joining"}
        onChange={(value) => {
          setBoardingStopId(value);
          if (value === alightingStopId) {
            setAlightingStopId("");
            onDestinationStopChange?.("");
          }
          selectionChanged();
        }}
        options={[{ value: "", label: "Choose boarding stop" }, ...stopOptions]}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
      />
      <InAppSelect
        name="destination-station"
        ariaLabel="Destination station"
        placeholder="Choose destination stop"
        value={alightingStopId}
        disabled={joinState === "joining"}
        onChange={(value) => {
          setAlightingStopId(value);
          onDestinationStopChange?.(value);
          selectionChanged();
        }}
        options={[{ value: "", label: "Choose destination stop" },
          ...stopOptions.filter((stop) => stop.value !== boardingStopId)]}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
      />
      <button
        type="button"
        onClick={() => void joinRide()}
        disabled={joinState === "joining" || joinState === "joined" || !boardingStopId || !alightingStopId ||
          boardingStopId === alightingStopId || Boolean(boardingBlockedReason)}
        className="rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "var(--status-live)", color: "var(--surface-0)" }}
      >
        {joinState === "joining" ? "Checking…" : joinState === "joined" ? "On board" : "Board"}
      </button>
      {boardHint && (
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{boardHint}</p>
      )}
      {joinState === "joining" && (
        <p className="text-[11px] font-semibold" style={{ color: "var(--status-warning)" }} role="status">
          Verifying your boarding stops and live bus position…
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
