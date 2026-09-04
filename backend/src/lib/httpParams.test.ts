import { describe, expect, it } from "vitest";
import { singlePathParam } from "./httpParams";

describe("singlePathParam", () => {
  it("accepts one scalar path parameter", () => {
    expect(singlePathParam("route_01")).toBe("route_01");
  });

  it("rejects wildcard arrays and missing values", () => {
    expect(singlePathParam(["route_01", "extra"])).toBe("");
    expect(singlePathParam(undefined)).toBe("");
  });
});
