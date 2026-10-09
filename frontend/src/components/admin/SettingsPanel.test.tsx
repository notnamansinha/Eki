// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPanel from "./SettingsPanel";
const mocks = vi.hoisted(() => ({ save: vi.fn(), settings: {
  serviceStartTime: "8:00 am", noBusesMessage: "No buses running", noBusesSubMessage: "Service starts at {time}", announcementText: "", announcementActive: false,
} }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ settings: mocks.settings, loading: false, saveSettings: mocks.save }) }));
beforeEach(() => { mocks.save.mockReset(); });
afterEach(cleanup);
describe("admin settings editing", () => {
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
});
