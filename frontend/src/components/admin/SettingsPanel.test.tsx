// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPanel from "./SettingsPanel";
import { hasUnsavedChanges } from "@/lib/unsavedChanges";
const mocks = vi.hoisted(() => ({ save: vi.fn(), error: null as string | null, settings: {
  serviceStartTime: "8:00 am", noBusesMessage: "No buses running", noBusesSubMessage: "Service starts at {time}", announcementText: "", announcementActive: false,
} }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ settings: mocks.settings, loading: false, error: mocks.error, saveSettings: mocks.save }) }));
beforeEach(() => { mocks.save.mockReset(); mocks.error = null; });
afterEach(cleanup);
describe("admin settings editing", () => {
  it("returns to unchanged after reverting text and toggling an announcement twice", async () => {
    render(<SettingsPanel />); const user = userEvent.setup();
    const field = screen.getByLabelText("Service Start Time");
    await user.clear(field); await user.type(field, "7:30 am");
    await user.clear(field); await user.type(field, "8:00 am");
    expect((screen.getByRole("button", { name: "No changes" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("switch")); await user.click(screen.getByRole("switch"));
    expect((screen.getByRole("button", { name: "No changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("omits a reverted field when saving another edited field", async () => {
    mocks.save.mockResolvedValue(undefined); render(<SettingsPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("switch")); await user.click(screen.getByRole("switch"));
    await user.clear(screen.getByLabelText("Service Start Time"));
    await user.type(screen.getByLabelText("Service Start Time"), "7:30 am");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Settings saved");
    expect(mocks.save).toHaveBeenCalledWith({ serviceStartTime: "7:30 am" });
  });
  it("saves only edited fields even when persisted settings include audit metadata", async () => {
    Object.assign(mocks.settings, { updatedAt: { seconds: 123 }, updatedBy: "admin" });
    try {
      mocks.save.mockResolvedValue(undefined); render(<SettingsPanel />); const user = userEvent.setup();
      await user.clear(screen.getByLabelText("Service Start Time")); await user.type(screen.getByLabelText("Service Start Time"), "7:30 am");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByText("Settings saved")).toBeTruthy();
      expect(mocks.save).toHaveBeenCalledWith({ serviceStartTime: "7:30 am" });
    } finally {
      Reflect.deleteProperty(mocks.settings, "updatedAt"); Reflect.deleteProperty(mocks.settings, "updatedBy");
    }
  });
  it("locks all draft fields while saving so later edits cannot be discarded by the pending save", async () => {
    let finish!: () => void;
    mocks.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<SettingsPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("Service Start Time"), " edited");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    try {
      for (const control of screen.getAllByRole("textbox")) expect((control as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    } finally {
      await act(async () => finish());
    }
  });
  it("keeps Save disabled until edits and reports success only after the save resolves", async () => {
    mocks.save.mockResolvedValue(undefined); render(<SettingsPanel />); const user = userEvent.setup();
    expect((screen.getByRole("button", { name: "No changes" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText("Service Start Time")); await user.type(screen.getByLabelText("Service Start Time"), "7:30 am");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Settings saved")).toBeTruthy();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ serviceStartTime: "7:30 am" }));
  });
  it("retains the draft and supports retry after a failed save", async () => {
    mocks.save.mockRejectedValueOnce(new Error("backend unavailable")).mockResolvedValueOnce(undefined);
    render(<SettingsPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("Service Start Time"), " edited");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Failed to save: backend unavailable");
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect((screen.getByLabelText("Service Start Time") as HTMLInputElement).value).toBe("8:00 am edited");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Settings saved")).toBeTruthy(); expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it("does not offer default values for editing when stored settings failed to load", () => {
    mocks.error = "Settings could not be loaded.";
    render(<SettingsPanel />);
    expect(screen.getByRole("alert").textContent).toContain("Settings could not be loaded.");
    expect(screen.queryByLabelText("Service Start Time")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports changed settings as unsaved only until they are reverted", async () => {
    render(<SettingsPanel />); const user = userEvent.setup();
    expect(hasUnsavedChanges()).toBe(false);
    const field = screen.getByLabelText("Service Start Time");
    await user.type(field, "x");
    expect(hasUnsavedChanges()).toBe(true);
    await user.type(field, "{Backspace}");
    expect(hasUnsavedChanges()).toBe(false);
  });
  it.each([
    ["6:30 am ($$ fare)", "Service starts at 6:30 am ($$ fare)"],
    ["$& sharp", "Service starts at $& sharp"],
    ["8:00 $'", "Service starts at 8:00 $'"],
  ])("previews a stored start time containing replacement patterns (%j) literally", (time, expected) => {
    const original = mocks.settings.serviceStartTime;
    mocks.settings.serviceStartTime = time;
    try {
      render(<SettingsPanel />);
      expect(screen.getByText(/^Preview:/).querySelector("strong")?.textContent).toBe(expected);
    } finally {
      mocks.settings.serviceStartTime = original;
    }
  });
});
