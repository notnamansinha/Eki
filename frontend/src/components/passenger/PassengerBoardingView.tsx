"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { BusFront, Check, Loader2, MapPin } from "lucide-react";
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
import { stopLabel } from "@/lib/stopLabel";

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
/** Shown beside every Board control before the browser can ask for location. */
const LOCATION_NOTICE = "Boarding shares your location once to check that you are at the stop.";
const JOINING_NOTICE = "Verifying your boarding stops and live bus position…";

/** The rail is 48 px wide: keep minutes and short states. The full label is in its description. */
function railEta(label: string) {
  if (/^(<1|\d+) min$/.test(label)) return label;
  if (label === "Bus is here") return "Here";
  if (label.startsWith("Passed")) return "Passed";
  return "–";
}

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
  // With both stops set the card docks into a rail under Back; the passenger
  // reopens it from the rail, and a failed join reopens it to show the error.
  const [expanded, setExpanded] = useState(false);
  const joinAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef(sessionId);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const focusRowsOnOpen = useRef(false);
  const tripDescriptionId = useId();
  const railNoteId = useId();
  const railReasonId = useId();
  // Adjust only the session result when props change. Keep the passenger's
  // draft choices, and never commit a frame showing the previous join.
  if (renderedSessionId !== sessionId) {
    setRenderedSessionId(sessionId);
    setHasJoined(false);
    setJoinState("idle");
    setJoinError("");
    setExpanded(false);
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

  const stops = route.stops ?? [];
  const progress = stopProgress(stops.length, {
    currentStopIndex: stopEstimates?.nextStopIndex,
    atStopIndex: stopEstimates?.atStopIndex,
    unobservedStopIndices: stopEstimates?.unobservedStopIndices,
  });
  const stopOptions = stops.map((stop, index) => ({
    value: stop.id,
    label: formatStopName(stop.name),
    detail: stopEstimateLabel(stopEstimates, stop.id, index),
    completed: isBehindBus(progress?.states[index]),
    badge: stopLabel(index),
  }));
  const boardingIndex = stops.findIndex(stop => stop.id === boardingStopId);
  const alightingIndex = stops.findIndex(stop => stop.id === alightingStopId);
  // Stops are in ride order, so a destination can only come after the boarding stop.
  const destinationOptions = boardingIndex >= 0 ? stopOptions.slice(boardingIndex + 1) : stopOptions;
  const stopsChosen = boardingIndex >= 0 && alightingIndex >= 0 && boardingStopId !== alightingStopId;
  const docked = stopsChosen && !expanded;
  const atStop = progress?.atStopIndex !== undefined ? route.stops?.[progress.atStopIndex] : undefined;
  const nextStop = progress?.nextStopIndex !== undefined ? route.stops?.[progress.nextStopIndex] : undefined;
  const progressSummary = [atStop ? `At ${atStop.name}` : undefined, nextStop ? `Next: ${nextStop.name}` : undefined]
    .filter(Boolean).join(" · ");
  const delayed = liveHealth?.state === "delayed";
  // Never claim "Live" without a health reading. Lost or offline outranks the
  // pre-departure warning; green only while in service and live.
  const healthDescription = liveHealth ? describeLiveBusHealth(liveHealth) : undefined;
  const statusTone = healthDescription?.tone === "danger" ? "danger"
    : tripState === "in_service" && healthDescription?.tone === "live" ? "live" : "warning";
  // The empty rows already ask for both stops; Board appears once they are set.
  const boardHint = joinState === "joining" || joinState === "joined" ? undefined
    : boardingBlockedReason ? boardingBlockedReason
    : boardingStopId && boardingStopId === alightingStopId ? "Choose two different stops." : undefined;
  const boardDisabled = joinState === "joining" || joinState === "joined" || !stopsChosen || Boolean(boardingBlockedReason);
  const boardLabel = joinState === "joining" ? "Checking…" : joinState === "joined" ? "On board" : "Board";
  // Beside the docked Board: progress while joining, else the location notice
  // until the first join. A paused-tracking reason is already in the header,
  // so the rail gives it to Board as its description instead.
  const railNote = joinState === "joining" ? JOINING_NOTICE
    : joinState === "joined" || hasJoined || boardingBlockedReason ? undefined : LOCATION_NOTICE;

  const joinRide = async () => {
    // State updates are batched; a ref closes the same-render double-click gap.
    if (joinAbortRef.current) return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    const currentUser = auth.currentUser;
    // The rail has no room for a reason; every failure reopens the card to show it.
    const fail = (message: string) => {
      setJoinState("error");
      setJoinError(message);
      setExpanded(true);
    };
    if (!backendUrl) {
      fail("Ride service is not configured.");
      return;
    }
    if (!currentUser) {
      fail("Sign in is required to board.");
      return;
    }
    if (!boardingStopId || !alightingStopId || boardingStopId === alightingStopId) {
      fail("Choose distinct boarding and destination stations.");
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
      setExpanded(false);
      onJoined?.();
    } catch (error) {
      if (!isCurrent()) return;
      // If the server no longer sees the prior manifest entry, the next attempt
      // must perform the first-boarding proximity check again.
      if (updatingExistingPassenger) setHasJoined(false);
      setJoinState("error");
      // The rail has no room for the reason; reopen the card to show it.
      setExpanded(true);
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
  const chooseBoarding = (value: string) => {
    const index = stops.findIndex(stop => stop.id === value);
    setBoardingStopId(value);
    // A destination at or before the new boarding stop no longer makes a trip.
    const keepDestination = Boolean(alightingStopId) && alightingIndex > index;
    if (alightingStopId && !keepDestination) {
      setAlightingStopId("");
      onDestinationStopChange?.("");
    }
    if (keepDestination) setExpanded(false);
    selectionChanged();
  };
  const chooseDestination = (value: string) => {
    setAlightingStopId(value);
    onDestinationStopChange?.(value);
    if (boardingIndex >= 0 && value) setExpanded(false);
    selectionChanged();
  };
  const openCard = () => {
    focusRowsOnOpen.current = true;
    setExpanded(true);
  };

  // Focus follows the card: onto the rail when it docks, into the rows when
  // the rail reopens it, so a keyboard user never lands on a hidden control.
  useLayoutEffect(() => {
    if (docked) {
      if (cardRef.current?.contains(document.activeElement)) railButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!focusRowsOnOpen.current) return;
    focusRowsOnOpen.current = false;
    cardRef.current?.querySelector<HTMLElement>("[role=combobox]:not(:disabled)")?.focus({ preventScroll: true });
  }, [docked]);

  // A reopened card tucks back into the rail on a tap outside it, or Escape.
  const tuckable = stopsChosen && expanded && joinState !== "joining";
  useEffect(() => {
    if (!tuckable) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [tuckable]);

  const boarding = boardingIndex >= 0 ? stops[boardingIndex] : undefined;
  const alighting = alightingIndex >= 0 ? stops[alightingIndex] : undefined;
  const boardingDetail = boarding ? stopOptions[boardingIndex].detail : "";
  const alightingDetail = alighting ? stopOptions[alightingIndex].detail : "";
  // Stop letters match the map markers (lib/stopLabel.ts).
  const originBadge = boarding
    ? <span className="pp-stop-badge" data-kind={hasJoined ? "boarded" : "origin"}>
      {hasJoined ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : stopLabel(boardingIndex)}
    </span>
    : <span className="pp-trip-ring" />;
  const destinationBadge = alighting
    ? <span className="pp-stop-badge">{stopLabel(alightingIndex)}</span>
    : <MapPin className="size-5" aria-hidden="true" style={{ color: "var(--accent)" }} />;
  const showFooter = !docked && (stopsChosen || Boolean(boardHint) || joinState !== "idle");

  return (
    <div ref={rootRef} className="pp-trip pointer-events-auto" data-docked={docked || undefined}>
      <div ref={cardRef} className="pp-float-card pp-trip-card animate-fade-in" data-reopened={expanded || undefined}>
        {/* Outside the hidden body, so the ride status still announces while docked. */}
        <div role="status" aria-live="polite" className="pp-trip-status">
          <p className="pp-status-title" data-tone={statusTone}>
            {tripState === "in_service" ? "Ride in service" : "Ride armed · awaiting stop 1"}
            {healthDescription && ` · ${healthDescription.title}`}
            {delayed && ` · ${formatUpdateAge(liveHealth?.ageMs)}`}
          </p>
          {progressSummary && <p className="pp-trip-progress">{progressSummary}</p>}
        </div>
        <div className="pp-trip-body" inert={docked} aria-hidden={docked || undefined}>
          <div className="pp-trip-rows">
            <InAppSelect
              appearance="row"
              leading={originBadge}
              name="boarding-stop"
              ariaLabel="Boarding stop"
              placeholder="Boarding stop"
              value={boardingStopId}
              disabled={joinState === "joining"}
              onChange={chooseBoarding}
              options={stopOptions}
            />
            <span className="pp-trip-divider" aria-hidden="true" />
            <InAppSelect
              appearance="row"
              leading={destinationBadge}
              name="destination-station"
              ariaLabel="Destination station"
              placeholder="Destination"
              value={alightingStopId}
              disabled={joinState === "joining"}
              onChange={chooseDestination}
              options={destinationOptions}
            />
            <span className="pp-trip-link" aria-hidden="true" />
          </div>
          {showFooter && (
            <div className="pp-trip-footer">
              {stopsChosen && (
                <button type="button" onClick={() => void joinRide()} disabled={boardDisabled} className="pp-btn-primary w-full">
                  {boardLabel}
                </button>
              )}
              {boardHint && <p className="pp-status-detail">{boardHint}</p>}
              {stopsChosen && !hasJoined && joinState !== "joining" && <p className="pp-status-detail">{LOCATION_NOTICE}</p>}
              {joinState === "joining" && <p className="pp-status-title" data-tone="warning" role="status">{JOINING_NOTICE}</p>}
              {joinState === "joined" && <p className="pp-status-title" data-tone="live" role="status">On board</p>}
              {joinState === "error" && <p className="pp-status-detail" data-tone="danger" role="alert">{joinError}</p>}
            </div>
          )}
        </div>
      </div>
      {stopsChosen && (
        // The rail under Back: both stop letters with their ETAs, then Board.
        <div className="pp-trip-dock" inert={!docked} aria-hidden={!docked || undefined}>
          <div className="pp-float-card pp-trip-rail">
            <button ref={railButtonRef} type="button" className="pp-rail-trip" aria-label="Change stops"
              aria-describedby={tripDescriptionId} onClick={openCard}>
              <span className="pp-rail-stop">
                {originBadge}
                <span className="pp-rail-eta" data-tone={hasJoined || boardingDetail === "Bus is here" ? "live" : undefined}>
                  {hasJoined ? "Boarded" : railEta(boardingDetail)}
                </span>
              </span>
              <span className="pp-rail-dots" aria-hidden="true" />
              <span className="pp-rail-stop">
                {destinationBadge}
                <span className="pp-rail-eta">{railEta(alightingDetail)}</span>
              </span>
            </button>
            <button type="button" className="pp-rail-board" data-state={joinState === "joined" ? "on" : joinState === "joining" ? "joining" : "board"}
              onClick={() => void joinRide()} disabled={boardDisabled}
              aria-describedby={[docked && railNote ? railNoteId : "", boardingBlockedReason && joinState !== "joined" ? railReasonId : ""].filter(Boolean).join(" ") || undefined}>
              {joinState === "joining"
                ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : joinState === "joined"
                  ? <Check className="size-4" strokeWidth={2.6} aria-hidden="true" />
                  : <BusFront className="size-[18px]" aria-hidden="true" />}
              <span className={joinState === "joining" ? "sr-only" : undefined}>{boardLabel}</span>
            </button>
          </div>
          <p id={tripDescriptionId} className="sr-only">
            {hasJoined ? `On board from ${boarding?.name}` : `From ${boarding?.name}, ${boardingDetail}`}, to {alighting?.name}, {alightingDetail}
          </p>
          {docked && railNote && (
            <p id={railNoteId} className="pp-rail-note" role={joinState === "joining" ? "status" : undefined}>{railNote}</p>
          )}
          {docked && boardingBlockedReason && joinState !== "joined" && <p id={railReasonId} className="sr-only">{boardingBlockedReason}</p>}
        </div>
      )}
    </div>
  );
}
