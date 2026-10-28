import { describe, expect, it } from "vitest";
import { isSafeDocumentId } from "./documentId";

describe("isSafeDocumentId", () => {
  it("accepts the documented 1-128 character ID alphabet", () => {
    for (const id of ["route_01", "a", "x".repeat(128), "__leading", "trailing__", "_a_", "a__b__c", "___"]) {
      expect(isSafeDocumentId(id), id).toBe(true);
    }
  });

  it("rejects Firestore-reserved __…__ IDs and malformed values", () => {
    for (const id of ["__main__", "____", "__x__", "__.__".replace(".", "a"), "", "x".repeat(129), "a/b", "a b", "é"]) {
      expect(isSafeDocumentId(id), id).toBe(false);
    }
    for (const value of [null, undefined, 1, ["route"], { id: "route" }]) expect(isSafeDocumentId(value)).toBe(false);
  });
});
