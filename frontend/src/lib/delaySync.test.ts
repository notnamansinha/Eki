import { describe, expect, it } from "vitest";
import { OptimisticDelay } from "./delaySync";

describe("OptimisticDelay", () => {
  it("starts at the initial confirmed value", () => {
    const delay = new OptimisticDelay(0);
    expect(delay.value).toBe(0);
  });

  it("shows the optimistic value after an apply", () => {
    const delay = new OptimisticDelay(0);
    expect(delay.apply(2)).toBe(2);
    expect(delay.value).toBe(2);
  });

  it("confirms the optimistic value on a successful write", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(3);
    expect(delay.confirm(3)).toBe(3);
    expect(delay.value).toBe(3);
  });

  it("reverts to the confirmed value when a write fails", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(2);
    expect(delay.revert(2)).toBe(0);
    expect(delay.value).toBe(0);
  });

  it("reverts to the last confirmed value, not the initial one", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(1);
    delay.confirm(1);
    delay.apply(5);
    expect(delay.revert(5)).toBe(1);
    expect(delay.value).toBe(1);
  });

  it("keeps a newer pending tap when an older write fails", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(1); // PATCH #1 in flight
    delay.apply(3); // PATCH #2 in flight (newer)
    // PATCH #1 fails: must not yank the newer optimistic value.
    expect(delay.revert(1)).toBe(3);
    expect(delay.value).toBe(3);
  });

  it("confirms an older success without clearing a newer pending tap", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(1);
    delay.apply(3);
    // PATCH #1 succeeds after #2 was applied: confirmed=1, optimistic 3 stays.
    expect(delay.confirm(1)).toBe(3);
    expect(delay.value).toBe(3);
  });

  it("keeps the display on the newest confirmed value when an older write fails", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(1);
    delay.apply(3);
    delay.confirm(3); // newer PATCH succeeds first
    // Older PATCH #1 fails afterwards: display must stay on 3.
    expect(delay.revert(1)).toBe(3);
    expect(delay.value).toBe(3);
  });

  it("reverts to the last confirmed value when the newest write fails", () => {
    const delay = new OptimisticDelay(0);
    delay.apply(1);
    delay.apply(3);
    delay.confirm(3);
    delay.apply(5);
    // Newest PATCH fails: drop the optimistic 5, show confirmed 3.
    expect(delay.revert(5)).toBe(3);
    expect(delay.value).toBe(3);
  });

  it("ignores confirm/revert for a value that is no longer relevant", () => {
    const delay = new OptimisticDelay(4);
    delay.confirm(7); // no optimistic value pending: just records the ack
    expect(delay.value).toBe(7);
    delay.revert(9); // nothing pending: no-op
    expect(delay.value).toBe(7);
  });
});
