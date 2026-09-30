import { describe, expect, it } from "vitest";
import { singleRouteParam } from "./requestParams";

describe("singleRouteParam", () => {
  it("returns scalar route parameters unchanged", () => {
    expect(singleRouteParam("bus_123")).toBe("bus_123");
  });

  it("rejects wildcard arrays and missing parameters", () => {
    expect(singleRouteParam(["bus", "123"])).toBeNull();
    expect(singleRouteParam(undefined)).toBeNull();
  });
});
