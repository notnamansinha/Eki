const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function validateVehicleInput(id: string, name: string, assignedRoutes: string[]): string | null {
  if (!id.trim()) return "Vehicle ID is required.";
  if (!SAFE_ID.test(id.trim())) return "Vehicle ID may contain only letters, numbers, hyphens, and underscores (max 128 characters).";
  if (!name.trim()) return "Vehicle display name is required.";
  if (name.trim().length > 100) return "Vehicle display name must be 100 characters or fewer.";
  if (assignedRoutes.length > 50) return "A vehicle can be assigned to at most 50 routes.";
  return null;
}

export function validateOperatorInput(id: string, name: string, authUid: string): string | null {
  if (!id.trim()) return "Operator ID is required.";
  if (!SAFE_ID.test(id.trim())) return "Operator ID may contain only letters, numbers, hyphens, and underscores (max 128 characters).";
  if (!name.trim()) return "Operator display name is required.";
  if (name.trim().length > 100) return "Operator display name must be 100 characters or fewer.";
  if (!authUid.trim()) return "Firebase Auth UID is required.";
  if (!SAFE_ID.test(authUid.trim())) return "Firebase Auth UID may contain only letters, numbers, hyphens, and underscores (max 128 characters).";
  return null;
}

export function validateSettingsInput(settings: {
  serviceStartTime: string;
  noBusesMessage: string;
  noBusesSubMessage: string;
  announcementText: string;
}): string | null {
  const fields: Array<[string, string, number, boolean]> = [
    ["Service start time", settings.serviceStartTime, 64, true],
    ["No-buses headline", settings.noBusesMessage, 200, true],
    ["No-buses subtext", settings.noBusesSubMessage, 300, true],
    ["Announcement text", settings.announcementText, 500, false],
  ];
  for (const [label, value, limit, required] of fields) {
    if (required && !value.trim()) return `${label} is required.`;
    if (value.length > limit) return `${label} must be ${limit} characters or fewer.`;
  }
  return null;
}
