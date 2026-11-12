import { describe, expect, it } from "vitest";
import { readReleaseIdentity } from "./releaseIdentity";

describe("readReleaseIdentity", () => {
  it("reports the baked-in commit and the Cloud Run service and revision", () => {
    expect(readReleaseIdentity({
      EKI_SOURCE_SHA: "f925ebd723949c3470cf2bf0eb9581638148ad6d",
      K_SERVICE: "eki-backend-staging",
      K_REVISION: "eki-backend-staging-00009-7sh",
    })).toEqual({
      sourceSha: "f925ebd723949c3470cf2bf0eb9581638148ad6d",
      service: "eki-backend-staging",
      revision: "eki-backend-staging-00009-7sh",
    });
  });

  it("reads missing, empty and malformed values as unknown", () => {
    expect(readReleaseIdentity({})).toEqual({ sourceSha: null, service: null, revision: null });
    // The Dockerfile default when the build passes no commit.
    expect(readReleaseIdentity({ EKI_SOURCE_SHA: "" }).sourceSha).toBeNull();
    for (const sourceSha of ["f925ebd", "main", "f925ebd723949c3470cf2bf0eb9581638148ad6dz", "<script>"]) {
      expect(readReleaseIdentity({ EKI_SOURCE_SHA: sourceSha }).sourceSha).toBeNull();
    }
    expect(readReleaseIdentity({ K_REVISION: "Revision With Spaces", K_SERVICE: "-leading" })).toEqual({
      sourceSha: null, service: null, revision: null,
    });
  });
});
