"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, ChevronLeft, Loader2, MapPin } from "lucide-react";
import { RouteData } from "@/hooks/useRoutes";
import { errorMessage } from "@/lib/errors";
import { auth } from "@/lib/firebaseAuth";
import { ApiError, apiRequest } from "@/lib/apiClient";
import { withTimeout } from "@/lib/promiseTimeout";
import { getAuthVerificationGeneration } from "@/lib/authState";
import { stopEstimateLabel, type PassengerStopEstimates } from "@/lib/passengerStopEstimates";
import { describeLiveBusHealth, formatUpdateAge, type LiveBusHealth } from "@/lib/liveBusHealth";
import { isBehindBus, stopProgress } from "@/lib/stopProgress";
import { stopLabel } from "@/lib/stopLabel";
import { boardDemoRide } from "@/lib/demoRide";
import StopPickerSheet, { type PickerField, type PickerStop } from "./StopPickerSheet";

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
  /** The demo ride boards without a location check or a join request. */
  demo?: boolean;
  onDestinationStopChange?: (stopId: string) => void;
  /** Lets the map label the chosen boarding stop. */
  onBoardingStopChange?: (stopId: string) => void;
  onJoined?: () => void;
}

type JoinState = "idle" | "joining" | "joined" | "error";
/** How far the bus has come to the boarding stop; each stage is a chance to board. */
type ArrivalStage = "arriving" | "at" | "left";

const PREPARATION_TIMEOUT_MS = 10_000;
const BOARDING_API_TIMEOUT_MS = 10_000;
/** The full From → To bar stays up this long after both stops are set, then slides into the drawer. */
export const TRIP_DOCK_DELAY_MS = 900;
/** Shown in the drawer until the first join, so it comes before the browser's location prompt. */
export const LOCATION_NOTICE = "When the bus reaches your stop, Eki checks your location once to mark you on board.";
export const DEMO_NOTICE = "Demo ride: you are marked on board when the bus reaches your stop. Your location is not used.";
const JOINING_NOTICE = "The bus has reached your stop. Checking your location to mark you on board…";
const ARRIVING_NOTICE = "The bus is almost at your stop. Checking your location to mark you on board…";
const UPDATING_NOTICE = "Updating your stops…";
const DEMO_JOINING_NOTICE = "The demo bus has reached your stop. Marking you on board…";

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

/** "4 min" → "bus in 4 min"; other labels describe the bus at the stop. */
function busEta(label: string, capital = false): string {
  const text = /^(\d+) min$/.test(label) ? `bus in ${label}`
    : label === "<1 min" ? "bus arriving"
    : label === "Bus is here" ? "bus is here"
    : label === "Passed" || label.startsWith("Passed ·") ? "bus has passed"
    : label === "Calculating" ? "calculating ETA" : label;
  return capital ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Destination ETA for a passenger on board. */
function rideEta(label: string, stopName: string): string {
  if (/^(\d+) min$/.test(label)) return `${label} to ${stopName}`;
  if (label === "<1 min") return `Arriving at ${stopName}`;
  if (label === "Bus is here") return `At ${stopName}`;
  if (label === "Calculating") return `Riding to ${stopName}`;
  if (label.startsWith("Passed")) return `Passed ${stopName}`;
  return label;
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
  demo = false,
  onDestinationStopChange,
  onBoardingStopChange,
  onJoined,
}: Props) {
  const [boardingStopId, setBoardingStopId] = useState("");
  const [alightingStopId, setAlightingStopId] = useState(destinationStopId ?? "");
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [joinError, setJoinError] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId);
  const [renderedDestination, setRenderedDestination] = useState(destinationStopId);
  // The route timeline, opened from the bar as a stop picker.
  const [picker, setPicker] = useState<PickerField | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const [showPassed, setShowPassed] = useState(false);
  // The active option is outlined only while the keyboard moves it.
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  // With both stops set the bar slides into a drawer on the right edge; ‹
  // pulls it back out, and a tap on the map or Escape tucks it away again.
  const [expanded, setExpanded] = useState(false);
  const joinAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef(sessionId);
  const rootRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLButtonElement>(null);
  const toRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const showTripRef = useRef<HTMLButtonElement>(null);
  const dockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOnDock = useRef(false);
  const focusOnOpen = useRef(false);
  const focusAfterJoin = useRef(false);
  // The trip (session and stops) last sent to boarding, so each is sent once.
  const submittedTrip = useRef<string | null>(null);
  // The parent's callback may change identity each render; keep effects stable.
  const boardingChange = useRef(onBoardingStopChange);
  useEffect(() => { boardingChange.current = onBoardingStopChange; });
  const id = useId();
  const listId = `${id}-stops`;
  const optionId = (index: number) => `${id}-stop-${index}`;
  const noteId = `${id}-note`;
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

  useEffect(() => () => { if (dockTimer.current) clearTimeout(dockTimer.current); }, []);

  useEffect(() => {
    if (!restoredBoarding) return;
    let current = true;
    queueMicrotask(() => {
      if (!current || !mountedRef.current || sessionRef.current !== sessionId) return;
      submittedTrip.current = `${sessionId}|${restoredBoarding.boardingStopId}|${restoredBoarding.alightingStopId ?? ""}`;
      setBoardingStopId(restoredBoarding.boardingStopId);
      boardingChange.current?.(restoredBoarding.boardingStopId);
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
  const boardingIndex = stops.findIndex(stop => stop.id === boardingStopId);
  const alightingIndex = stops.findIndex(stop => stop.id === alightingStopId);
  const boarding = boardingIndex >= 0 ? stops[boardingIndex] : undefined;
  const alighting = alightingIndex >= 0 ? stops[alightingIndex] : undefined;
  // Stops are in ride order, so a trip runs from the boarding stop to a later one.
  const stopsChosen = boardingIndex >= 0 && alightingIndex > boardingIndex;
  const docked = stopsChosen && !expanded && picker === null;
  // Still on board while changed stops are being sent.
  const onBoard = hasJoined && joinState !== "error";
  const detailFor = (index: number) => stopEstimateLabel(stopEstimates, stops[index].id, index);
  const boardingDetail = boarding ? detailFor(boardingIndex) : "";
  const alightingDetail = alighting ? detailFor(alightingIndex) : "";
  const pickerStops = (field: PickerField): PickerStop[] => stops.map((stop, index) => ({
    stop,
    index,
    letter: stopLabel(index),
    visit: progress?.states[index],
    detail: detailFor(index),
    // A trip needs a later stop, so the terminus is never a boarding stop;
    // passed stops stay choosable for boarding so a late or restored
    // passenger can name theirs. A destination comes after the boarding stop
    // and ahead of the bus.
    selectable: field === "boarding"
      ? index < stops.length - 1
      : index > boardingIndex && !isBehindBus(progress?.states[index]),
  }));
  const selectableIndices = (field: PickerField) => pickerStops(field).filter(entry => entry.selectable).map(entry => entry.index);

  const atStop = progress?.atStopIndex !== undefined ? stops[progress.atStopIndex] : undefined;
  const nextStop = progress?.nextStopIndex !== undefined ? stops[progress.nextStopIndex] : undefined;
  const progressSummary = [atStop ? `At ${atStop.name}` : undefined, nextStop ? `Next: ${nextStop.name}` : undefined]
    .filter(Boolean).join(" · ");
  const delayed = liveHealth?.state === "delayed";
  const healthDescription = liveHealth ? describeLiveBusHealth(liveHealth) : undefined;
  const boardingVisit = boardingIndex >= 0 ? progress?.states[boardingIndex] : undefined;
  // The bus has reached the boarding stop: it is there, or it has been and
  // gone (a passenger already on it is still within the 150 m check). A real
  // bus under a minute away counts too, since the origin may not be marked
  // "at" before it departs; the demo bus always stops, so it waits for "at".
  const arrivalStage: ArrivalStage | undefined = boardingVisit === "at" ? "at"
    : isBehindBus(boardingVisit) ? "left"
    : !demo && boardingVisit === "next" && boardingDetail === "<1 min" ? "arriving"
    : undefined;
  const trip = `${sessionId}|${boardingStopId}|${alightingStopId}`;
  // A passenger not yet on board gets one attempt per stage; one on board
  // has each change of stops sent once.
  const sendKey = hasJoined ? trip : `${trip}|${arrivalStage}`;

  // Above the drawer: what is happening now, else why boarding waits, else
  // the location notice until the first join (FR-PAS-053).
  const note: { text: string; tone?: "danger"; role?: "alert" | "status" } | undefined =
    joinState === "error" && joinError ? { text: joinError, tone: "danger", role: "alert" }
    : joinState === "joining" ? { text: demo ? DEMO_JOINING_NOTICE : hasJoined ? UPDATING_NOTICE : arrivalStage === "arriving" ? ARRIVING_NOTICE : JOINING_NOTICE, role: "status" }
    : onBoard ? undefined
    : boardingBlockedReason && stopsChosen ? { text: boardingBlockedReason }
    : stopsChosen && !hasJoined ? { text: demo ? DEMO_NOTICE : LOCATION_NOTICE }
    : undefined;

  const joinRide = async (automatic = false) => {
    // State updates are batched; a ref closes the same-render double-click gap.
    if (joinAbortRef.current) return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    const currentUser = auth.currentUser;
    if (!demo && !backendUrl) {
      setJoinState("error");
      setJoinError("Ride service is not configured.");
      return;
    }
    if (!demo && !currentUser) {
      setJoinState("error");
      setJoinError("Sign in is required to board.");
      return;
    }
    if (!stopsChosen) {
      setJoinState("error");
      setJoinError("Choose distinct boarding and destination stations.");
      return;
    }

    submittedTrip.current = sendKey;
    const stage = arrivalStage;
    setJoinState("joining");
    setJoinError("");
    const updatingExistingPassenger = hasJoined;
    const controller = new AbortController();
    joinAbortRef.current = controller;
    const authGeneration = getAuthVerificationGeneration();
    const isCurrent = () => mountedRef.current &&
      joinAbortRef.current === controller && !controller.signal.aborted &&
      sessionRef.current === sessionId && (demo || auth.currentUser === currentUser) &&
      getAuthVerificationGeneration() === authGeneration;
    try {
      if (demo) {
        // There is no passenger to locate, so a first boarding needs the demo
        // bus at the stop; one that has left it went without them.
        if (!updatingExistingPassenger && boardingVisit !== "at") {
          throw new Error(`The demo bus has already left ${stops[boardingIndex].name}. Choose a stop ahead of it.`);
        }
        await boardDemoRide(controller.signal);
      } else {
        const [token, position] = await Promise.all([
          withTimeout(untilCancelled(currentUser!.getIdToken(), controller.signal), PREPARATION_TIMEOUT_MS, "Sign-in verification timed out. Please try again."),
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
      }
      if (!isCurrent()) return;
      // Try again leaves the drawer once on board; keep keyboard focus in it.
      focusAfterJoin.current = document.activeElement === retryRef.current;
      submittedTrip.current = trip;
      setHasJoined(true);
      setJoinState("joined");
      onJoined?.();
    } catch (error) {
      if (!isCurrent()) return;
      // If the server no longer sees the prior manifest entry, the next attempt
      // must perform the first-boarding proximity check again.
      if (updatingExistingPassenger) setHasJoined(false);
      // Still too far while the bus was arriving: say nothing, and board when
      // it is at the stop.
      if (automatic && !updatingExistingPassenger && stage === "arriving" && error instanceof ApiError && error.status === 403) {
        setJoinState("idle");
        return;
      }
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

  // There is no Board button: the passenger is marked on board when the bus
  // reaches their stop, and changed stops are sent once they are on board.
  // Nothing is sent twice for the same key; after a failure, Try again or the
  // bus's next stage (at the stop, then gone) tries again.
  const readyToSend = stopsChosen && !boardingBlockedReason && joinState !== "joining" &&
    (hasJoined || arrivalStage !== undefined);
  const joinLatest = useRef(joinRide);
  useEffect(() => { joinLatest.current = joinRide; });
  useEffect(() => {
    if (!readyToSend || submittedTrip.current === sendKey) return;
    submittedTrip.current = sendKey;
    let current = true;
    queueMicrotask(() => { if (current) void joinLatest.current(true); });
    return () => { current = false; };
  }, [readyToSend, sendKey]);

  const cancelDock = () => {
    if (dockTimer.current) clearTimeout(dockTimer.current);
    dockTimer.current = null;
  };
  /** Show the whole trip for a moment, then slide it into the drawer. */
  const settle = () => {
    cancelDock();
    setExpanded(true);
    dockTimer.current = setTimeout(() => {
      dockTimer.current = null;
      if (!mountedRef.current) return;
      focusOnDock.current = rootRef.current?.contains(document.activeElement) ?? false;
      setExpanded(false);
    }, TRIP_DOCK_DELAY_MS);
  };

  const openPicker = (field: PickerField, index?: number, fromKeyboard = false) => {
    setKeyboardNavigation(fromKeyboard);
    cancelDock();
    const choices = selectableIndices(field);
    const value = field === "boarding" ? boardingIndex : alightingIndex;
    const upcoming = choices.find(choice => !isBehindBus(progress?.states[choice]));
    const start = index ?? (choices.includes(value) ? value : upcoming ?? choices[0]);
    if (start !== undefined && isBehindBus(progress?.states[start])) setShowPassed(true);
    setActiveIndex(start);
    setPicker(field);
    setExpanded(true);
  };
  const closePicker = () => {
    setPicker(null);
    setShowPassed(false);
    setActiveIndex(undefined);
    if (stopsChosen) settle();
  };

  const chooseBoarding = (value: string) => {
    const index = stops.findIndex(stop => stop.id === value);
    setBoardingStopId(value);
    boardingChange.current?.(value);
    // A destination at or before the new boarding stop no longer makes a trip.
    const keepDestination = alightingIndex > index;
    if (alightingStopId && !keepDestination) {
      setAlightingStopId("");
      onDestinationStopChange?.("");
    }
    selectionChanged();
    if (keepDestination) {
      setPicker(null);
      setShowPassed(false);
      settle();
      return;
    }
    // Straight on to the destination, as the concept's single list does.
    const next = stops.findIndex((_, stopIndex) => stopIndex > index);
    setPicker(next >= 0 ? "destination" : null);
    setActiveIndex(next >= 0 ? next : undefined);
    if (next >= 0 && rootRef.current?.contains(document.activeElement)) {
      queueMicrotask(() => toRef.current?.focus({ preventScroll: true }));
    }
  };
  const chooseDestination = (value: string) => {
    const index = stops.findIndex(stop => stop.id === value);
    setAlightingStopId(value);
    onDestinationStopChange?.(value);
    selectionChanged();
    setPicker(null);
    setShowPassed(false);
    if (boardingIndex >= 0 && index > boardingIndex) {
      settle();
    } else {
      // Destination first: now ask where they board.
      const firstUpcoming = stops.findIndex((_, stopIndex) => stopIndex < index && !isBehindBus(progress?.states[stopIndex]));
      setPicker("boarding");
      setActiveIndex(firstUpcoming >= 0 ? firstUpcoming : 0);
      if (rootRef.current?.contains(document.activeElement)) queueMicrotask(() => fromRef.current?.focus({ preventScroll: true }));
    }
  };
  const choose = (field: PickerField, value: string) => (field === "boarding" ? chooseBoarding : chooseDestination)(value);

  const reopen = () => {
    cancelDock();
    focusOnOpen.current = true;
    setExpanded(true);
  };

  // Focus follows the bar: onto the drawer when it docks, into the bar when
  // the drawer reopens it, so a keyboard user never lands on a removed control.
  useLayoutEffect(() => {
    if (docked) {
      if (!focusOnDock.current) return;
      focusOnDock.current = false;
      (retryRef.current ?? showTripRef.current)?.focus({ preventScroll: true });
      return;
    }
    if (!focusOnOpen.current) return;
    focusOnOpen.current = false;
    fromRef.current?.focus({ preventScroll: true });
  }, [docked]);

  useLayoutEffect(() => {
    if (!onBoard || !focusAfterJoin.current) return;
    focusAfterJoin.current = false;
    showTripRef.current?.focus({ preventScroll: true });
  }, [onBoard]);

  // A reopened bar tucks back into the drawer on a tap outside it, or Escape.
  const tuckable = stopsChosen && expanded && picker === null;
  useEffect(() => {
    if (!tuckable) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        cancelDock();
        setExpanded(false);
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      cancelDock();
      focusOnDock.current = rootRef.current?.contains(document.activeElement) ?? false;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [tuckable]);

  // Escape closes the picker from anywhere, as the timeline sheet does.
  useEffect(() => {
    if (picker === null) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closePicker();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });

  useEffect(() => {
    if (picker === null || activeIndex === undefined) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  });

  const handleKeyDown = (field: PickerField) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const open = picker === field;
    const choices = selectableIndices(field);
    if (choices.length === 0) return;
    if (event.key === "Escape") {
      if (picker !== null) { event.preventDefault(); event.stopPropagation(); closePicker(); }
      return;
    }
    if (event.key === "Tab") {
      if (picker !== null) closePicker();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && activeIndex !== undefined && choices.includes(activeIndex)) choose(field, stops[activeIndex].id);
      else openPicker(field, undefined, true);
      return;
    }
    const offsets: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (event.key in offsets || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setKeyboardNavigation(true);
      if (!open) { openPicker(field, undefined, true); return; }
      const position = Math.max(0, choices.indexOf(activeIndex ?? choices[0]));
      const target = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
        : Math.max(0, Math.min(choices.length - 1, position + offsets[event.key]));
      const next = choices[target];
      if (isBehindBus(progress?.states[next])) setShowPassed(true);
      setActiveIndex(next);
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = event.key.toLocaleLowerCase();
      const from = open && activeIndex !== undefined ? choices.indexOf(activeIndex) : -1;
      const match = [...choices.slice(from + 1), ...choices.slice(0, from + 1)]
        .find(choice => stops[choice].name.toLocaleLowerCase().startsWith(key));
      if (match === undefined) return;
      event.preventDefault();
      if (isBehindBus(progress?.states[match])) setShowPassed(true);
      setKeyboardNavigation(true);
      if (open) setActiveIndex(match); else openPicker(field, match, true);
    }
  };

  const comboboxProps = (field: PickerField) => ({
    type: "button" as const,
    role: "combobox",
    "aria-haspopup": "listbox" as const,
    "aria-expanded": picker === field,
    "aria-controls": picker === field ? listId : undefined,
    "aria-activedescendant": picker === field && activeIndex !== undefined ? optionId(activeIndex) : undefined,
    disabled: stops.length < 2,
  });
  // Tapping the field that is already open keeps its list open.
  const openOnClick = (field: PickerField) => { if (picker !== field) openPicker(field); };

  // A failed check can be tried again; the demo has no location to retry with.
  const canRetry = joinState === "error" && !demo && stopsChosen && !boardingBlockedReason;

  const fromKicker = !boarding ? "From" : onBoard ? "From · on board" : `From · ${busEta(boardingDetail)}`;
  const toKicker = alighting && !/^Passed/.test(alightingDetail) ? `To · ${alightingDetail === "Bus is here" ? "bus is here" : alightingDetail}` : "To";
  const badge = (index: number, kind: "origin" | "destination") => onBoard && kind === "origin"
    ? <span className="pp-trip-badge" data-kind="boarded"><Check className="size-3.5" strokeWidth={3} aria-hidden="true" /></span>
    : <span className="pp-trip-badge" data-kind={kind}>{stopLabel(index)}</span>;
  const statusTone = healthDescription?.tone === "danger" ? "danger"
    : tripState === "in_service" && healthDescription?.tone === "live" ? "live" : "warning";

  return (
    <div ref={rootRef} className="pp-trip" data-docked={docked || undefined}>
      <input type="hidden" name="boarding-stop" value={boardingStopId} />
      <input type="hidden" name="destination-station" value={alightingStopId} />
      {/* The visible status is the timeline's peek; this keeps changes announced. */}
      <div role="status" aria-live="polite" className="sr-only">
        <p data-tone={statusTone}>
          {tripState === "in_service" ? "Ride in service" : "Ride armed · awaiting stop 1"}
          {healthDescription && ` · ${healthDescription.title}`}
          {delayed && ` · ${formatUpdateAge(liveHealth?.ageMs)}`}
        </p>
        {progressSummary && <p>{progressSummary}</p>}
        {onBoard && <p>On board</p>}
      </div>
      {note && !docked && joinState === "error" && (
        <p id={noteId} className="pp-trip-note" data-tone={note.tone} role={note.role}>{note.text}</p>
      )}
      {docked && boarding && alighting ? (
        <div className="pp-trip-stack">
        {note && <p id={noteId} className="pp-trip-note" data-tone={note.tone} role={note.role}>{note.text}</p>}
        <div className="pp-trip-drawer" role="group" aria-label="Your trip">
          <button ref={showTripRef} type="button" className="pp-trip-drawer-open" aria-label="Show trip" aria-expanded={false} onClick={reopen}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          {badge(boardingIndex, "origin")}
          <div className="pp-trip-drawer-text">
            <p className="pp-trip-drawer-title" data-tone={onBoard ? "live" : undefined}>{onBoard ? "On board" : boarding.name}</p>
            <p className="pp-trip-drawer-detail">{onBoard ? rideEta(alightingDetail, alighting.name) : busEta(boardingDetail, true)}</p>
          </div>
          {joinState === "joining" && (
            <Loader2 className="pp-trip-checking size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          )}
          {canRetry && (
            <button ref={retryRef} type="button" className="pp-trip-board" onClick={() => void joinRide()} aria-describedby={noteId}>
              Try again
            </button>
          )}
        </div>
        </div>
      ) : (
        <div className="pp-trip-bar" data-picking={picker ?? undefined}>
          <button ref={fromRef} {...comboboxProps("boarding")} onClick={() => openOnClick("boarding")} onKeyDown={event => handleKeyDown("boarding")(event)} aria-label="Boarding stop" className="pp-trip-field" data-empty={!boarding || undefined}>
            {boarding ? badge(boardingIndex, "origin") : <span className="pp-trip-ring" aria-hidden="true" />}
            <span className="pp-trip-field-text">
              <span className="pp-trip-kicker" data-tone={onBoard ? "live" : undefined}>{fromKicker}</span>
              <span className="pp-trip-value">{boarding?.name ?? "Your stop"}</span>
            </span>
          </button>
          <span className="pp-trip-arrow" aria-hidden="true"><ArrowRight className="size-3.5" /></span>
          <button ref={toRef} {...comboboxProps("destination")} onClick={() => openOnClick("destination")} onKeyDown={event => handleKeyDown("destination")(event)} aria-label="Destination station" className="pp-trip-field" data-empty={!alighting || undefined}>
            {alighting ? badge(alightingIndex, "destination") : <MapPin className="pp-trip-pin size-5" aria-hidden="true" />}
            <span className="pp-trip-field-text">
              <span className="pp-trip-kicker">{toKicker}</span>
              <span className="pp-trip-value">{alighting?.name ?? "Where to?"}</span>
            </span>
          </button>
        </div>
      )}
      {picker && (
        <StopPickerSheet
          field={picker}
          listId={listId}
          optionId={optionId}
          stops={pickerStops(picker)}
          activeIndex={activeIndex}
          showActive={keyboardNavigation}
          value={picker === "boarding" ? boardingStopId : alightingStopId}
          boardingStop={boarding}
          boardingIndex={boardingIndex}
          showPassed={showPassed}
          onShowPassed={() => setShowPassed(true)}
          onChoose={value => choose(picker, value)}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
