import { describe, expect, it } from "vitest";
import { resolveFirebaseAuthDomain } from "./firebaseAuthDomain";

describe("resolveFirebaseAuthDomain", () => {
  it("uses the live web.app hostname so Firebase Auth stays same-origin", () => {
    expect(
      resolveFirebaseAuthDomain(
        "bustrack-be165.firebaseapp.com",
        "bustrack-be165",
        "bustrack-be165.web.app",
      ),
    ).toBe("bustrack-be165.web.app");
  });

  it("keeps the matching firebaseapp.com hostname", () => {
    expect(
      resolveFirebaseAuthDomain(
        "bustrack-be165.web.app",
        "bustrack-be165",
        "bustrack-be165.firebaseapp.com",
      ),
    ).toBe("bustrack-be165.firebaseapp.com");
  });

  it("preserves an explicitly configured domain outside Firebase Hosting", () => {
    expect(
      resolveFirebaseAuthDomain(
        "auth.university.example",
        "bustrack-be165",
        "localhost",
      ),
    ).toBe("auth.university.example");
  });

  it("preserves the configured domain during static rendering", () => {
    expect(
      resolveFirebaseAuthDomain(
        "bustrack-be165.firebaseapp.com",
        "bustrack-be165",
        undefined,
      ),
    ).toBe("bustrack-be165.firebaseapp.com");
  });
});
