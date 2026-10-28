import { describe, expect, it } from "vitest";
import { formatNoBusesSubMessage } from "./serviceMessages";

describe("formatNoBusesSubMessage", () => {
  it("substitutes the service start time for {time}", () => {
    expect(formatNoBusesSubMessage("Service starts at {time}", "8:00 am")).toBe("Service starts at 8:00 am");
  });
  it.each([
    ["6:30 am ($$ fare)", "Service starts at 6:30 am ($$ fare)"],
    ["$& sharp", "Service starts at $& sharp"],
    ["8:00 $'", "Service starts at 8:00 $'"],
    ["$`7:00", "Service starts at $`7:00"],
  ])("inserts a start time containing replacement patterns (%j) literally", (time, expected) => {
    expect(formatNoBusesSubMessage("Service starts at {time}", time)).toBe(expected);
  });
  it("keeps single-occurrence substitution and leaves templates without {time} unchanged", () => {
    expect(formatNoBusesSubMessage("{time} / {time}", "8:00")).toBe("8:00 / {time}");
    expect(formatNoBusesSubMessage("Check back later", "8:00")).toBe("Check back later");
  });
});
