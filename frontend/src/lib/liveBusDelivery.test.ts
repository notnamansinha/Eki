import { describe, expect, it } from "vitest";
import { isAuthoritativeLiveBusDelivery } from "./liveBusDelivery";

describe("isAuthoritativeLiveBusDelivery", () => {
  it("acknowledges only listener-originated snapshots", () => {
    expect(isAuthoritativeLiveBusDelivery("listener")).toBe(true);
    expect(isAuthoritativeLiveBusDelivery("cache")).toBe(false);
    expect(isAuthoritativeLiveBusDelivery("expiry")).toBe(false);
    expect(isAuthoritativeLiveBusDelivery("invalidation")).toBe(false);
  });
});
