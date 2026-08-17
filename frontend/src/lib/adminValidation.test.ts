import { describe, expect, it } from "vitest";
import { validateOperatorInput, validateSettingsInput, validateVehicleInput } from "./adminValidation";

describe("admin form validation", () => {
  it("reports missing and malformed vehicle fields instead of silently doing nothing", () => {
    expect(validateVehicleInput("", "Bus one", [])).toBe("Vehicle ID is required.");
    expect(validateVehicleInput("bus one", "Bus one", [])).toContain("letters, numbers");
    expect(validateVehicleInput("bus_1", "   ", [])).toBe("Vehicle display name is required.");
    expect(validateVehicleInput(" bus_1 ", " Bus one ", ["route_1"])).toBeNull();
  });

  it("matches the operator API's ID, name, and Auth UID constraints", () => {
    expect(validateOperatorInput("drv_1", "Ravi", "")).toBe("Firebase Auth UID is required.");
    expect(validateOperatorInput("drv_1", "Ravi", "uid with spaces")).toContain("letters, numbers");
    expect(validateOperatorInput(" drv_1 ", " Ravi ", " uid_1 ")).toBeNull();
  });

  it("matches the settings API's required fields and length limits", () => {
    const valid = {
      serviceStartTime: "8:00 am",
      noBusesMessage: "No buses running",
      noBusesSubMessage: "Service starts at {time}",
      announcementText: "",
    };
    expect(validateSettingsInput(valid)).toBeNull();
    expect(validateSettingsInput({ ...valid, noBusesMessage: " " })).toBe("No-buses headline is required.");
    expect(validateSettingsInput({ ...valid, announcementText: "x".repeat(501) })).toBe("Announcement text must be 500 characters or fewer.");
  });
});
