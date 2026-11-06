// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PassengerDate, { localDateKey } from "./PassengerDate";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keys the date in the passenger's own zone, not UTC", () => {
  // 00:30 on 5 November in Ahmedabad is still 4 November in UTC.
  expect(localDateKey(new Date(2026, 10, 5, 0, 30))).toBe("2026-11-05");
  expect(localDateKey(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
});

it("gives the visible date a matching machine-readable date", () => {
  vi.useFakeTimers({ now: new Date(2026, 10, 5, 0, 30) });
  render(<PassengerDate />);
  expect(screen.getByText(/5 November/).getAttribute("datetime")).toBe("2026-11-05");
});
