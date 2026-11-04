// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BottomSheet from "./BottomSheet";
afterEach(cleanup);
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
});
