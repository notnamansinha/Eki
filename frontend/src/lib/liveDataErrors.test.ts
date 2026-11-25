import { describe, expect, it } from "vitest";
import { classifyLiveReadFailure, isPermissionDeniedError, liveDataStatus } from "./liveDataErrors";

describe("live data read failure classification", () => {
  it("recognises RTDB and Firestore permission denials", () => {
    expect(isPermissionDeniedError(Object.assign(new Error("permission_denied at /a: Client doesn't have permission"), { code: "PERMISSION_DENIED" }))).toBe(true);
    expect(isPermissionDeniedError(new Error("permission_denied at /activeBuses: Client doesn't have permission to access the desired data."))).toBe(true);
    expect(isPermissionDeniedError({ code: "permission-denied", message: "Missing or insufficient permissions." })).toBe(true);
  });

  it("treats other failures as unavailable", () => {
    expect(isPermissionDeniedError(new Error("Network request failed"))).toBe(false);
    expect(isPermissionDeniedError(new Error("QA synthetic detail PERMISSION_DENIED"))).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
    expect(isPermissionDeniedError("permission_denied")).toBe(false);
    expect(classifyLiveReadFailure(new Error("disconnect"))).toBe("unavailable");
  });

  it("only calls a denial an access problem while the socket is connected", () => {
    expect(liveDataStatus({ isConnected: true, isResuming: true, readFailure: "permission_denied" })).toBe("access_denied");
    expect(liveDataStatus({ isConnected: false, isResuming: true, readFailure: "permission_denied" })).toBe("connecting");
    expect(liveDataStatus({ isConnected: true, isResuming: true, readFailure: "unavailable" })).toBe("connecting");
    expect(liveDataStatus({ isConnected: true, isResuming: false, readFailure: "unavailable" })).toBe("read_failed");
    expect(liveDataStatus({ isConnected: true, isResuming: false, readFailure: null })).toBe("live");
  });
});
