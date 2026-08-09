export const MAX_MESSAGES_PER_HOUR = 60;
export const MIN_GAP_MS = 3_000;
export const HOUR_MS = 60 * 60 * 1000;

export type ChatRateCheck =
  | { allowed: true; nextSentAt: number[] }
  | { allowed: false; reason: "hourly" | "cooldown"; retryAfterMs: number };

export function evaluateChatRate(
  existing:
    | {
        sentAt?: number[];
        lastSentAt?: number;
        windowStartedAt?: number;
        count?: number;
      }
    | undefined,
  now: number,
): ChatRateCheck {
  let previous: number[] = [];
  let lastSentAt: number | null = null;

  if (existing && Array.isArray(existing.sentAt)) {
    const sentAt = existing.sentAt.filter((t: number) => Number.isFinite(t));
    const last = Number.isFinite(existing.lastSentAt) ? existing.lastSentAt ?? null : null;
    previous = [...sentAt, ...(last === null ? [] : [last])]
      .sort((left, right) => left - right)
      .slice(-MAX_MESSAGES_PER_HOUR);
    if (previous.length > 0) {
      lastSentAt = previous[previous.length - 1];
    }
  } else if (
    existing &&
    Number.isFinite(existing.windowStartedAt) &&
    Number.isFinite(existing.lastSentAt)
  ) {
    // Legacy doc: { windowStartedAt, lastSentAt, count }
    const windowStartedAt = existing.windowStartedAt as number;
    const last = existing.lastSentAt as number;
    const count = Math.max(1, Math.min(MAX_MESSAGES_PER_HOUR, Number(existing.count) || 1));
    if (now - windowStartedAt < HOUR_MS) {
      previous = [...Array<number>(count - 1).fill(windowStartedAt), last];
    }
    lastSentAt = last;
  }

  if (lastSentAt === null) {
    // First message: no stored window.
    return { allowed: true, nextSentAt: [] };
  }

  const gapMs = now - lastSentAt;
  if (gapMs < MIN_GAP_MS) {
    return { allowed: false, reason: "cooldown", retryAfterMs: MIN_GAP_MS - gapMs };
  }

  if (previous.length >= MAX_MESSAGES_PER_HOUR) {
    const oldest = previous[0];
    const windowElapsed = now - oldest;
    if (windowElapsed < HOUR_MS) {
      return { allowed: false, reason: "hourly", retryAfterMs: HOUR_MS - windowElapsed };
    }
    return { allowed: true, nextSentAt: previous.slice(1) };
  }

  return { allowed: true, nextSentAt: previous };
}

const PROFANITY_REGEX =
  /\b(fuck|shit|bitch|ass|asshole|cunt|dick|pussy|bastard|mc|bc|madarchod|bhenchod|chutiya|gandu|bhosadike|bhosdi|harami|kutta|slut|whore|randi|muth|bhosada)\b/gi;

export function censorText(text: string): string {
  return text.replace(PROFANITY_REGEX, "***");
}
