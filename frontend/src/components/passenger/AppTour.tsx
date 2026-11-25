"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";

/*
 * The app tour: a short, hands-on walk through the passenger app. Each step
 * dims everything but one part of the real screen. On a "try it" step that
 * part stays live and pulses: the passenger taps the demo ride, picks their
 * own stops, then opens Routes and Profile, and the tour moves on as they do.
 * Next does the step for them (and is the keyboard and screen reader path);
 * Skip at the top of the card ends the tour.
 */

export type TourStepId = "welcome" | "welcome-no-ride" | "stops" | "drawer" | "routes" | "profile";

interface StepContent {
  title: string;
  body: string;
  /** The spotlit part stays usable and the tour waits for the passenger to use it. */
  tryIt?: boolean;
  /** The first selector that matches a visible element is spotlit. */
  targets: string[];
}

export const TOUR_STEPS: Record<TourStepId, StepContent> = {
  welcome: {
    title: "Welcome to Eki",
    body: "Live routes lists every bus running now. Tap the demo ride to try one.",
    tryIt: true,
    targets: ['[data-passenger-route="demo-ride"]', ".passenger-home-heading"],
  },
  "welcome-no-ride": {
    title: "Welcome to Eki",
    body: "Live routes lists every bus running now. Choose one to see where it is and when it reaches your stop.",
    targets: [".passenger-home-heading"],
  },
  stops: {
    title: "Choose your stops",
    body: "Tap From, then pick where you board and where you're going. Arrival times are live.",
    tryIt: true,
    // While the passenger picks, the route timeline is the part to use.
    targets: ["[data-tracking-dock] .pp-picker", "[data-tracking-dock] .pp-trip-bar", "[data-tracking-dock] .pp-trip"],
  },
  drawer: {
    title: "Your trip, out of the way",
    body: "Your stops tuck into this drawer with the bus's arrival time. When the bus reaches your stop, you're marked on board automatically.",
    // The drawer with the boarding note above it, which says how boarding works.
    targets: ["[data-tracking-dock] .pp-trip-stack", "[data-tracking-dock] .pp-trip-drawer", "[data-tracking-dock] .pp-trip"],
  },
  routes: {
    title: "Timetables",
    body: "Tap Routes to see every line with its stops and scheduled times.",
    tryIt: true,
    targets: ['[data-tour="routes-tab"]'],
  },
  profile: {
    title: "Your profile",
    body: "Tap Profile to send feedback, manage your account or replay this tour.",
    tryIt: true,
    targets: ['[data-tour="profile-tab"]'],
  },
};

interface Props {
  steps: TourStepId[];
  index: number;
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

function findTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    const box = element?.getBoundingClientRect();
    if (element && box && box.width > 0 && box.height > 0) return element;
  }
  return null;
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

export default function AppTour({ steps, index, onNext, onSkip }: Props) {
  const stepId = steps[index];
  const step = TOUR_STEPS[stepId];
  const last = index === steps.length - 1;
  const id = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onSkip);
  const [layout, setLayout] = useState<Layout>({ target: null, viewport: { width: 0, height: 0 }, card: { width: 0, height: 0 } });
  const scrolledStep = useRef<string | null>(null);

  // Follow the spotlit element every frame: screens slide and sheets rise
  // between steps, and the trip bar turns into the drawer under the spotlight.
  // A timer backs up the frame loop where frames are throttled.
  useEffect(() => {
    let frame = 0;
    const measureOnce = () => {
      const element = findTarget(step.targets);
      if (element && scrolledStep.current !== stepId) {
        scrolledStep.current = stepId;
        element.scrollIntoView?.({ block: "nearest" });
      }
      const box = element?.getBoundingClientRect();
      const card = dialogRef.current;
      const next: Layout = {
        target: box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        card: { width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 },
      };
      setLayout(previous => sameLayout(previous, next) ? previous : next);
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
  }, [step, stepId, dialogRef]);

  const position = cardPosition(layout);
  const { target, viewport } = layout;
  const hole = target ? {
    top: target.top - SPOTLIGHT_PADDING,
    left: target.left - SPOTLIGHT_PADDING,
    width: target.width + SPOTLIGHT_PADDING * 2,
    height: target.height + SPOTLIGHT_PADDING * 2,
  } : null;
  const live = Boolean(step.tryIt && hole);

  return createPortal(
    <div className="pp-tour" data-tour-step={stepId}>
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
      {hole ? (
        <div className="pp-tour-spotlight" data-live={live || undefined} aria-hidden="true" style={hole} />
      ) : (
        <div className="pp-tour-scrim" aria-hidden="true" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        tabIndex={-1}
        className="pp-tour-card"
        // Until the card is measured its place is a guess; keep it transparent, not hidden from assistive tech.
        style={{ top: position.top, left: position.left, opacity: layout.card.height > 0 ? undefined : 0 }}
      >
        {/* The card's content takes focus when it opens, so screen readers read the step and
            touch users see no focus ring; Tab reaches Skip and Next. */}
        <div className="pp-tour-content" tabIndex={-1} data-autofocus>
        <div className="pp-tour-header">
          <p className="pp-tour-count">
            {index + 1} of {steps.length}
            {step.tryIt && <span className="pp-tour-try"> · Your turn</span>}
          </p>
          {!last && (
            <button type="button" className="pp-tour-skip" onClick={onSkip} aria-label="Skip tour">
              Skip
            </button>
          )}
        </div>
        <h2 id={`${id}-title`} className="pp-tour-title">{step.title}</h2>
        <hr className="pp-tour-rule" aria-hidden="true" />
        <p id={`${id}-body`} className="pp-tour-body">{step.body}</p>
        <div className="pp-tour-footer">
          <div className="pp-tour-dots" aria-hidden="true">
            {steps.map((entry, position) => (
              <span key={entry} className="pp-tour-dot" data-active={position === index || undefined} />
            ))}
          </div>
          <button type="button" className="pp-btn-primary pp-tour-next" onClick={onNext}>
            {last ? "Done" : "Next"}
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
