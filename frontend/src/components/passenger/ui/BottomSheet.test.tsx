// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BottomSheet from "./BottomSheet";
afterEach(cleanup);
/** A finger drag on the handle, followed by the click a browser sends on lift. */
function swipe(target: HTMLElement, fromY: number, toY: number, toX = 100, click = true) {
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: fromY });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch", clientX: toX, clientY: toY });
  if (click) fireEvent.click(target);
}
function Sheet() {
  const [open, setOpen] = useState(false);
  return <BottomSheet isOpen={open} onToggle={() => setOpen(value => !value)} headerTitle="Configured route">
    <button>Stop details</button>
  </BottomSheet>;
}
describe("timeline keyboard and hidden content", () => {
  it("opens with Enter, hides collapsed controls and closes with Escape restoring focus", async () => {
    render(<Sheet />); const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Configured route" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Stop details" })).toBeNull();
    // The floating desktop dock leaves the collapsed body uncovered, so it must not paint.
    const content = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(content.classList.contains("opacity-0")).toBe(true);
    // Short-screen CSS keys off the open state to move the ride controls aside.
    const sheet = toggle.closest("[data-map-sheet]")!;
    expect(sheet.hasAttribute("data-open")).toBe(false);
    toggle.focus(); await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(content.classList.contains("opacity-100")).toBe(true);
    expect(sheet.hasAttribute("data-open")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Stop details" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole("button", { name: "Stop details" })).toBeNull();
  });
  it("closes with the accessible backdrop control", async () => {
    render(<Sheet />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Configured route" }));
    await user.click(screen.getByRole("button", { name: "Close Configured route" }));
    expect(screen.getByRole("button", { name: "Configured route" }).getAttribute("aria-expanded")).toBe("false");
  });
  it("clips the collapsed sheet, background included, to its 56px header", async () => {
    render(<Sheet />); const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Configured route" });
    const sheet = toggle.closest<HTMLElement>("[data-map-sheet]")!;
    // The body slides behind the navigation, which the floating desktop dock leaves uncovered.
    expect(sheet.style.clipPath).toBe("inset(-40px 0 calc(100% - 56px))");
    await user.click(toggle);
    expect(sheet.style.clipPath).toBe("inset(-40px 0 0)");
    // One transition for the slide and the clip keeps the moving edge on the navigation.
    expect(sheet.classList.contains("transition-[translate,clip-path]")).toBe(true);
  });
});
describe("swiping the handle", () => {
  it("opens on an upward swipe and closes on a downward swipe", () => {
    render(<Sheet />);
    const toggle = screen.getByRole("button", { name: "Configured route" });
    // The gesture alone toggles: a finger that ends off the handle sends no click.
    swipe(toggle, 400, 300, 100, false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    swipe(toggle, 300, 400, 100, false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    swipe(toggle, 400, 300);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    swipe(toggle, 300, 400);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
  it("ignores swipes the wrong way and sideways drags instead of toggling", () => {
    render(<Sheet />);
    const toggle = screen.getByRole("button", { name: "Configured route" });
    swipe(toggle, 300, 400);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    swipe(toggle, 400, 395, 200);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    swipe(toggle, 400, 300);
    swipe(toggle, 400, 300);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
  it("still toggles on a tap with a little finger wobble", () => {
    render(<Sheet />);
    const toggle = screen.getByRole("button", { name: "Configured route" });
    swipe(toggle, 400, 396);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
  it("keeps the browser from scrolling the page while the handle is dragged", () => {
    render(<Sheet />);
    expect(screen.getByRole("button", { name: "Configured route" }).classList.contains("touch-none")).toBe(true);
  });
});
