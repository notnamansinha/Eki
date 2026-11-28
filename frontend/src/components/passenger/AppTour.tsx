"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";

/*
 * The app tour: a short, hands-on walk through the passenger app. Each step
 * dims everything but one part of the real screen. On a "try it" step that
 * part stays live and pulses: the passenger opens the Vaishnodevi route (a bus
 * the tour drives in this browser), picks their own stops, then opens Routes
 * and Profile, and the tour moves on as they do. Next does the step for them
 * (and is the keyboard and screen reader path); Skip at the top of the card
 * ends the tour.
 */

export type TourStepId = "welcome" | "welcome-no-ride" | "stops" | "drawer" | "chat" | "routes" | "profile";

interface StepContent {
  title: string;
  body: string;
  /** The spotlit part stays usable and the tour waits for the passenger to use it. */
  tryIt?: boolean;
  /** The first selector that matches a visible element is spotlit. */
  targets: string[];
  /** Shown once the passenger is on the step's screen (Routes, Profile). */
  reached?: Omit<StepContent, "reached">;
}

export const TOUR_STEPS: Record<TourStepId, StepContent> = {
  welcome: {
    title: "Welcome to Eki",
    body: "Tap a route to track its bus.",
    tryIt: true,
    targets: ['[data-passenger-route="tour-ride"]', ".passenger-home-heading"],
  },
  "welcome-no-ride": {
    title: "Welcome to Eki",
    body: "Choose a route to see its bus live.",
    targets: [".passenger-home-heading"],
  },
  stops: {
    title: "Choose your stops",
    body: "Tap From, then pick two stops.",
    tryIt: true,
    // While the passenger picks, the route timeline is the part to use.
    targets: ["[data-tracking-dock] .pp-picker", "[data-tracking-dock] .pp-trip-bar", "[data-tracking-dock] .pp-trip"],
  },
  drawer: {
    title: "Your trip",
    body: "You're marked on board when the bus reaches your stop.",
    // The drawer with the boarding note above it, which says how boarding works.
    targets: ["[data-tracking-dock] .pp-trip-stack", "[data-tracking-dock] .pp-trip-drawer", "[data-tracking-dock] .pp-trip"],
  },
  chat: {
    title: "Text the driver",
    body: "Chat with your driver from here.",
    targets: ['[data-tour="chat"]'],
  },
  routes: {
    title: "Timetables",
    body: "Tap Routes.",
    tryIt: true,
    targets: ['[data-tour="routes-tab"]'],
    // On Routes, a route row is the part to tap; the step ends when its timetable opens.
    reached: {
      title: "Timetables",
      body: "Tap a route to see its stops and times.",
      tryIt: true,
      targets: ['[data-tour="route-row"]'],
    },
  },
  profile: {
    title: "Your profile",
    body: "Tap Profile.",
    tryIt: true,
    targets: ['[data-tour="profile-tab"]'],
    // On Profile the tour closes beside the row that replays it.
    reached: {
      title: "You're all set",
      body: "Replay this tour any time from here.",
      targets: ['[data-tour="replay-tour"]'],
    },
  },
};

interface Props {
  steps: TourStepId[];
  index: number;
  /** The passenger is on this step's screen; show its `reached` content. */
  reached?: boolean;
  onNext: () => void;
  onSkip: () => void;
}

interface Layout {
  target: { top: number; left: number; width: number; height: number } | null;
  viewport: { width: number; height: number };
  card: { width: number; height: number };
}

const GUTTER = 16;
const GAP = 14;
const SPOTLIGHT_PADDING = 6;
/**
 * How long a step waits for its own part of the screen (a sheet rising, a
 * screen sliding in) before it settles for a fallback or for none.
 */
const SETTLE_MS = 700;
/** Before the tour first appears, its target holds still this long: the page may still be laying out. */
const FIRST_STILL_MS = 150;

function findTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    // A section that is not showing keeps its layout but is hidden and inert; skip it.
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find(candidate => !candidate.closest('[aria-hidden="true"], [inert]'));
    const box = element?.getBoundingClientRect();
    if (element && box && box.width > 0 && box.height > 0) return element;
  }
  return null;
}

/** A finite transition or animation is moving `element` or a part of the page around it. */
function inMotion(element: HTMLElement): boolean {
  if (typeof document.getAnimations !== "function") return false;
  return document.getAnimations().some(animation => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === "running" && target instanceof Element && target.contains(element) &&
      animation.effect?.getComputedTiming().iterations !== Infinity;
  });
}

function sameLayout(a: Layout, b: Layout) {
  const t = a.target, u = b.target;
  return a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height &&
    a.card.width === b.card.width && a.card.height === b.card.height &&
    (t === u || (t !== null && u !== null && t.top === u.top && t.left === u.left && t.width === u.width && t.height === u.height));
}

/** The card sits beside the spotlight, on the side with more room, inside the screen. */
function cardPosition({ target, viewport, card }: Layout): { top: number; left: number } {
  const left = (centre: number) => Math.max(GUTTER, Math.min(viewport.width - GUTTER - card.width, centre - card.width / 2));
  if (!target) return { top: Math.max(GUTTER, (viewport.height - card.height) / 2), left: left(viewport.width / 2) };
  const above = target.top - SPOTLIGHT_PADDING - GAP;
  const below = viewport.height - (target.top + target.height + SPOTLIGHT_PADDING + GAP);
  const top = below >= card.height || below >= above
    ? target.top + target.height + SPOTLIGHT_PADDING + GAP
    : target.top - SPOTLIGHT_PADDING - GAP - card.height;
  return {
    top: Math.max(GUTTER, Math.min(viewport.height - GUTTER - card.height, top)),
    left: left(target.left + target.width / 2),
  };
}

export default function AppTour({ steps, index, reached = false, onNext, onSkip }: Props) {
  const stepId = steps[index];
  const base = TOUR_STEPS[stepId];
  const step = reached && base.reached ? base.reached : base;
  // Each phase of a step is spotlit and scrolled to on its own.
  const phase = reached && base.reached ? `${stepId}:reached` : stepId;
  // The closing card: the last step once nothing is left to try.
  const finishing = index === steps.length - 1 && !step.tryIt;
  const id = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onSkip);
  const [layout, setLayout] = useState<Layout>({ target: null, viewport: { width: 0, height: 0 }, card: { width: 0, height: 0 } });
  // The step whose spotlight is in place. The tour fades in once the first
  // one is, so it never sweeps in from where a sheet was before it settled.
  const [placedPhase, setPlacedPhase] = useState<string | null>(null);
  const everPlaced = useRef(false);
  const scrolledStep = useRef<string | null>(null);
  // Shown a frame after the first placement, so the card and spotlight are
  // painted in place before their transitions switch on.
  const [shown, setShown] = useState(false);
  const firstPlaced = placedPhase !== null;
  useEffect(() => {
    if (!firstPlaced) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [firstPlaced]);

  // Follow the spotlit element every frame: screens slide and sheets rise
  // between steps, and the trip bar turns into the drawer under the spotlight.
  // A new step keeps the last spotlight until its own part has appeared and
  // stopped moving, then glides there. A timer backs up the frame loop where
  // frames are throttled.
  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    let placed = false;
    let lastBox = "";
    let stillSince = started;
    let missingSince: number | null = null;
    const measureOnce = () => {
      const now = performance.now();
      const waited = now - started > SETTLE_MS;
      const element = findTarget(step.targets);
      if (element && scrolledStep.current !== phase) {
        scrolledStep.current = phase;
        element.scrollIntoView?.({ block: "nearest" });
      }
      const box = element?.getBoundingClientRect();
      const boxKey = box ? `${box.top},${box.left},${box.width},${box.height}` : "";
      if (boxKey !== lastBox) stillSince = now;
      const unmoved = boxKey !== "" && boxKey === lastBox && now - stillSince >= (everPlaced.current ? 0 : FIRST_STILL_MS);
      lastBox = boxKey;
      missingSince = box ? null : missingSince ?? now;
      const card = dialogRef.current;
      const sizes = {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        card: { width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 },
      };
      // Hold the last spotlight until this step's part has settled (in the same
      // place as last frame, with nothing sliding it), and briefly when a placed
      // part goes (its screen is changing), so the spotlight glides rather than
      // flashing to a full dim.
      const hold = placed
        ? missingSince !== null && now - missingSince < SETTLE_MS
        : !waited && !(unmoved && !inMotion(element!));
      if (hold) {
        // The card still fits its new copy.
        setLayout(previous => {
          const next = { ...previous, ...sizes };
          return sameLayout(previous, next) ? previous : next;
        });
        return;
      }
      placed = true;
      everPlaced.current = true;
      const next: Layout = { target: box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null, ...sizes };
      setLayout(previous => sameLayout(previous, next) ? previous : next);
      setPlacedPhase(phase);
    };
    const loop = () => {
      measureOnce();
      frame = window.requestAnimationFrame(loop);
    };
    loop();
    const timer = window.setInterval(measureOnce, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [step, phase, dialogRef]);

  const position = cardPosition(layout);
  const { target, viewport } = layout;
  const hole = target ? {
    top: target.top - SPOTLIGHT_PADDING,
    left: target.left - SPOTLIGHT_PADDING,
    width: target.width + SPOTLIGHT_PADDING * 2,
    height: target.height + SPOTLIGHT_PADDING * 2,
  } : null;
  // The spotlight opens for taps only once it has reached this step's part.
  const live = Boolean(step.tryIt && hole && placedPhase === phase);

  return createPortal(
    <div className="pp-tour" data-tour-step={stepId} data-shown={shown || undefined}>
      {/* Taps outside the card and the live spotlight do nothing. On a try-it step four
          blockers frame the spotlight, so taps inside it reach the real control. */}
      {live && hole ? (
        <>
          <div className="pp-tour-blocker" aria-hidden="true" style={{ bottom: "auto", height: Math.max(0, hole.top) }} />
          <div className="pp-tour-blocker" aria-hidden="true" style={{ top: hole.top + hole.height }} />
          <div className="pp-tour-blocker" aria-hidden="true" style={{ top: hole.top, height: hole.height, right: "auto", width: Math.max(0, hole.left) }} />
          <div className="pp-tour-blocker" aria-hidden="true" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width, width: Math.max(0, viewport.width - hole.left - hole.width), right: "auto" }} />
        </>
      ) : (
        <div className="pp-tour-blocker" aria-hidden="true" />
      )}
      {/* Keyed apart, so a new spotlight opens where it belongs instead of
          gliding out of the scrim's corner. */}
      {hole ? (
        <div key="spotlight" className="pp-tour-spotlight" data-live={live || undefined} aria-hidden="true" style={hole} />
      ) : (
        <div key="scrim" className="pp-tour-scrim" aria-hidden="true" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        tabIndex={-1}
        className="pp-tour-card"
        // Until the first spotlight is in place the tour is transparent (see `data-shown`), not hidden from assistive tech.
        style={{ top: position.top, left: position.left }}
      >
        {/* The card's content takes focus when it opens, so screen readers read the step and
            touch users see no focus ring; Tab reaches Skip and Next. */}
        <div className="pp-tour-content" tabIndex={-1} data-autofocus>
        <div className="pp-tour-header">
          <p className="pp-tour-count">
            {index + 1} of {steps.length}
            {step.tryIt && <span className="pp-tour-try"> · Your turn</span>}
          </p>
          {!finishing && (
            <button type="button" className="pp-tour-skip" onClick={onSkip} aria-label="Skip tour">
              Skip
            </button>
          )}
        </div>
        {/* Each step's copy fades in as the spotlight moves. */}
        <div key={phase} className="pp-tour-copy">
          <h2 id={`${id}-title`} className="pp-tour-title">{step.title}</h2>
          <hr className="pp-tour-rule" aria-hidden="true" />
          <p id={`${id}-body`} className="pp-tour-body">{step.body}</p>
        </div>
        <div className="pp-tour-footer">
          <div className="pp-tour-dots" aria-hidden="true">
            {steps.map((entry, position) => (
              <span key={entry} className="pp-tour-dot" data-active={position === index || undefined} />
            ))}
          </div>
          <button type="button" className="pp-btn-primary pp-tour-next" onClick={onNext}>
            {finishing ? "Done" : "Next"}
          </button>
        </div>
        </div>
        {/* Focus stays put between steps, so announce each new one. */}
        <p className="sr-only" role="status" aria-live="polite">
          {`Step ${index + 1} of ${steps.length}: ${step.title}`}
        </p>
      </div>
    </div>,
    document.body,
  );
}
