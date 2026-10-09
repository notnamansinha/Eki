// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearJoinedRidePointer, readJoinedRidePointer, saveJoinedRidePointer } from "./joinedRidePointer";
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe("joined ride hints", () => {
  it("scopes hints to an account and stores only session identity and age", () => {
    saveJoinedRidePointer("one", "ride_1");
    expect(readJoinedRidePointer("one")).toBe("ride_1");
    expect(readJoinedRidePointer("two")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem("eki:joinedRide:one")!))).toEqual(["sessionId", "savedAt"]);
    clearJoinedRidePointer("one"); expect(readJoinedRidePointer("one")).toBeNull();
  });
  it.each(["broken", '{"sessionId":"bad/path","savedAt":1}', '{"sessionId":"ride","savedAt":"1"}', '{"sessionId":"ride","savedAt":100001}'])("rejects malformed or future hints %s", value => {
    localStorage.setItem("eki:joinedRide:one", value); expect(readJoinedRidePointer("one", 100000)).toBeNull();
  });
  it("expires hints after one day", () => {
    localStorage.setItem("eki:joinedRide:one", JSON.stringify({ sessionId: "ride", savedAt: 1 }));
    expect(readJoinedRidePointer("one", 86400002)).toBeNull();
  });
  it("does not prevent boarding when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw Error("blocked"); });
    expect(() => saveJoinedRidePointer("one", "ride")).not.toThrow();
    expect(readJoinedRidePointer("one")).toBeNull(); expect(() => clearJoinedRidePointer("one")).not.toThrow();
  });
});
