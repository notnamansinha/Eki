export const MAX_MESSAGES_PER_HOUR = 60;
export const MAX_MESSAGES_PER_MINUTE = 10;
export const MIN_GAP_MS = 3_000;
export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
const MAX_CHAT_INPUT_LENGTH = 2_000;

export type ChatRateCheck =
  | { allowed: true; nextSentAt: number[] }
  | { allowed: false; reason: "hourly" | "burst" | "cooldown"; retryAfterMs: number };

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

  const hourlyWindow = previous.filter((timestamp) => now - timestamp < HOUR_MS);
  if (hourlyWindow.length >= MAX_MESSAGES_PER_HOUR) {
    return {
      allowed: false,
      reason: "hourly",
      retryAfterMs: HOUR_MS - (now - hourlyWindow[0]),
    };
  }

  const burstWindow = hourlyWindow.filter((timestamp) => now - timestamp < MINUTE_MS);
  if (burstWindow.length >= MAX_MESSAGES_PER_MINUTE) {
    return {
      allowed: false,
      reason: "burst",
      retryAfterMs: MINUTE_MS - (now - burstWindow[0]),
    };
  }

  return { allowed: true, nextSentAt: hourlyWindow };
}

const PROFANITY_TERMS = [
  "fuck", "fucker", "fucking", "shit", "bitch", "ass", "asshole", "cunt",
  "dick", "pussy", "bastard", "mc", "bc", "madarchod", "bhenchod",
  "behenchod", "chutiya", "gandu", "bhosadike", "bhosdi", "harami", "kutta",
  "slut", "whore", "randi", "muth", "bhosada", "मादरचोद", "बहनचोद", "भेंचोद",
  "चूतिया", "गांडू", "रंडी", "हरामी",
] as const;

const CHARACTER_VARIANTS: Record<string, string> = {
  a: "[a@4áàâäãå]",
  b: "[b8]",
  c: "[cç(]",
  e: "[e3éèêë]",
  g: "[g69]",
  i: "[i1!|íìîï]",
  k: "[k]",
  o: "[o0óòôöõ]",
  s: "[s5$]",
  t: "[t7+]",
  u: "[uüúùûv]",
};
const OBFUSCATION_SEPARATOR = "[\\p{M}\\p{Cf}\\p{P}\\p{S}\\s_]*";

function escapeRegex(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function profanityPattern(term: string): string {
  return Array.from(term.normalize("NFKC").toLowerCase())
    .map((character) => `${CHARACTER_VARIANTS[character] ?? escapeRegex(character)}+`)
    .join(OBFUSCATION_SEPARATOR);
}

const PROFANITY_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${PROFANITY_TERMS.map(profanityPattern).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

const UNSAFE_FORMATTING = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;

export function normalizeChatText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(UNSAFE_FORMATTING, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function censorText(text: string): string {
  return text.replace(PROFANITY_REGEX, "***");
}

export type ModeratedChatText = {
  text: string;
  normalized: string;
  censored: boolean;
};

export function moderateChatText(value: unknown): ModeratedChatText | null {
  if (typeof value !== "string" || value.length > MAX_CHAT_INPUT_LENGTH) return null;
  const normalized = normalizeChatText(value);
  if (!normalized || Array.from(normalized).length > MAX_CHAT_MESSAGE_LENGTH) return null;
  const text = censorText(normalized);
  return { text, normalized, censored: text !== normalized };
}
