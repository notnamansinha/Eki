import { useRef, type MouseEvent, type PointerEvent } from "react";

/** A drag at least this far reads as a swipe, not a tap. */
export const SHEET_SWIPE_MIN_PX = 28;
/** A short, quick flick counts too: this far at this speed. */
const FLICK_MIN_PX = 12;
const FLICK_MIN_PX_PER_MS = 0.4;
/** Touch browsers can fire the tap's click a little after the finger lifts. */
const CLICK_SUPPRESS_MS = 450;

interface SheetSwipeOptions {
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Swipe handling for a sheet handle that is already a toggle button: swiping up
 * opens a closed sheet and swiping down closes an open one. Taps and the
 * keyboard keep working through the button's own click. A drag is never also a
 * tap, so swiping the wrong way does nothing instead of toggling, and a
 * keyboard activation right after a swipe still toggles.
 */
export function useSheetSwipe({ isOpen, onToggle }: SheetSwipeOptions) {
  const start = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const suppressClickUntil = useRef(0);

  const finish = (event: PointerEvent<HTMLElement>) => {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;
    start.current = null;
    const dy = event.clientY - origin.y;
    const dx = event.clientX - origin.x;
    const distance = Math.abs(dy);
    const elapsed = Math.max(1, event.timeStamp - origin.at);
    const swiped = distance >= SHEET_SWIPE_MIN_PX
      || (distance >= FLICK_MIN_PX && distance / elapsed >= FLICK_MIN_PX_PER_MS);
    // Mostly sideways movement is neither a swipe nor a tap.
    if (Math.abs(dx) > distance && Math.abs(dx) >= FLICK_MIN_PX) {
      suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS;
      return;
    }
    if (!swiped) return;
    suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS;
    if ((dy < 0 && !isOpen) || (dy > 0 && isOpen)) onToggle();
  };

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
      suppressClickUntil.current = 0;
      // Keep tracking when the finger leaves the handle mid-swipe.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerUp: finish,
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      if (start.current?.id === event.pointerId) start.current = null;
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // Keyboard and assistive-technology activation sends a click with
      // detail 0; only a pointer's click (detail >= 1) can be the swipe's own.
      if (event.detail === 0) return;
      if (Date.now() >= suppressClickUntil.current) return;
      suppressClickUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
