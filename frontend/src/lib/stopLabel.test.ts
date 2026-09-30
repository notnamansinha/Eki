import { describe, expect, it } from "vitest";
import { stopLabel } from "./stopLabel";

describe("stopLabel", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [51, "AZ"],
    [52, "BA"],
    [99, "CV"],
  ])("labels stop index %i as %s", (index, label) => {
    expect(stopLabel(index)).toBe(label);
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid index %p", (index) => {
    expect(stopLabel(index)).toBe("?");
  });
});
