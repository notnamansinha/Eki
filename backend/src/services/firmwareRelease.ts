const VERSION_PATTERN = /^s([1-9][0-9]{0,9})-[A-Za-z0-9][A-Za-z0-9._-]{0,18}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_FIRMWARE_BYTES = 0x1E0000;

export interface FirmwareRelease {
  version: string;
  sequence: number;
  url: string;
  sha256: string;
  size: number;
}

export type FirmwareReleaseConfiguration =
  | { state: "disabled" }
  | { state: "invalid" }
  | { state: "ready"; release: FirmwareRelease };

function releaseUrl(value: string | undefined): string | null {
  if (!value || value.length > 512) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Read one immutable signed-firmware descriptor from deployment configuration.
 * An entirely absent descriptor disables OTA; a partial or malformed descriptor
 * fails closed so devices never receive ambiguous update metadata.
 */
export function readFirmwareRelease(
  environment: NodeJS.ProcessEnv = process.env,
): FirmwareReleaseConfiguration {
  const values = [
    environment.FIRMWARE_RELEASE_VERSION,
    environment.FIRMWARE_RELEASE_SEQUENCE,
    environment.FIRMWARE_RELEASE_URL,
    environment.FIRMWARE_RELEASE_SHA256,
    environment.FIRMWARE_RELEASE_SIZE,
  ];
  if (values.every((value) => value === undefined || value.trim() === "")) {
    return { state: "disabled" };
  }

  const version = environment.FIRMWARE_RELEASE_VERSION?.trim() ?? "";
  const sequence = Number(environment.FIRMWARE_RELEASE_SEQUENCE);
  const url = releaseUrl(environment.FIRMWARE_RELEASE_URL?.trim());
  const sha256 = environment.FIRMWARE_RELEASE_SHA256?.trim().toLowerCase() ?? "";
  const size = Number(environment.FIRMWARE_RELEASE_SIZE);
  const versionSequence = VERSION_PATTERN.exec(version)?.[1];
  if (
    !versionSequence ||
    !Number.isSafeInteger(sequence) ||
    sequence <= 0 ||
    Number(versionSequence) !== sequence ||
    !url ||
    !SHA256_PATTERN.test(sha256) ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_FIRMWARE_BYTES
  ) {
    return { state: "invalid" };
  }

  return {
    state: "ready",
    release: { version, sequence, url, sha256, size },
  };
}

export function parseFirmwareSequence(value: unknown): number | null {
  if (typeof value !== "string" || !/^[0-9]{1,10}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
