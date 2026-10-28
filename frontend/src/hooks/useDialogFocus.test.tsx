// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useDialogFocus } from "./useDialogFocus";

// Frames run only when a test flushes them, so focus races are deterministic.
let frames: FrameRequestCallback[] = [];
const flushFrames = () => act(() => { const pending = frames; frames = []; pending.forEach(frame => frame(0)); });
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames[id - 1] = () => {}; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Dialog({ onClose = () => {} }: { onClose?: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(true, onClose);
  return <div ref={ref} role="dialog" tabIndex={-1}>
    <button type="button" onClick={onClose}>Close</button>
    <textarea aria-label="Comment" />
  </div>;
}

describe("dialog initial focus", () => {
  it("focuses the first control when nothing inside the dialog has focus", () => {
    render(<Dialog />);
    flushFrames();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });
  it("still moves focus to the first control when only the dialog container is focused", () => {
    render(<Dialog />);
    screen.getByRole("dialog").focus();
    flushFrames();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });
  it("does not steal focus from a control the user already focused inside the dialog", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    const comment = screen.getByRole("textbox", { name: "Comment" });
    comment.focus();
    flushFrames();
    expect(document.activeElement).toBe(comment);
    // A space typed next must land in the text box, not press Close.
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(onClose).not.toHaveBeenCalled();
  });
});
