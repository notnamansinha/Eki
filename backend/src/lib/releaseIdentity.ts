/**
 * The build and Cloud Run revision this process runs, for the admin-only
 * /api/health (issue #504). Public /health and /live stay status-only.
 *
 * EKI_SOURCE_SHA is baked into the image by the backend deploy job
 * (`docker build --build-arg EKI_SOURCE_SHA=<commit>`). Cloud Run sets
 * K_SERVICE and K_REVISION itself. A missing or malformed value reads as
 * null, so a hand-built image or a local process reports "unknown" rather
 * than a guess.
 */
export interface ReleaseIdentity {
  sourceSha: string | null;
  service: string | null;
  revision: string | null;
}

const SOURCE_SHA = /^[0-9a-f]{40}$/;
// Cloud Run service and revision names: lowercase letters, digits and hyphens.
const CLOUD_RUN_NAME = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function matching(value: string | undefined, pattern: RegExp): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && pattern.test(trimmed) ? trimmed : null;
}

export function readReleaseIdentity(env: NodeJS.ProcessEnv = process.env): ReleaseIdentity {
  return {
    sourceSha: matching(env.EKI_SOURCE_SHA, SOURCE_SHA),
    service: matching(env.K_SERVICE, CLOUD_RUN_NAME),
    revision: matching(env.K_REVISION, CLOUD_RUN_NAME),
  };
}
