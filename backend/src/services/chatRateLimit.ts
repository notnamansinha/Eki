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
const OBFUSCATION_SEPARATOR = /^[\p{M}\p{Cf}\p{P}\p{S}\s_]$/u;
const WORD_CHARACTER = /^[\p{L}\p{N}]$/u;

function escapeRegex(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function profanityPattern(term: string): RegExp[] {
  return Array.from(term.normalize("NFKC").toLowerCase())
    .map((character) => new RegExp(`^(?:${CHARACTER_VARIANTS[character] ?? escapeRegex(character)})$`, "iu"));
}

const PROFANITY_PATTERNS = PROFANITY_TERMS.map(profanityPattern);

const UNSAFE_FORMATTING = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;

export function normalizeChatText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(UNSAFE_FORMATTING, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function censorText(text: string): string {
  const characters = Array.from(text);
  const size = characters.length;
  const separators = characters.map(character => OBFUSCATION_SEPARATOR.test(character));
  const word = characters.map(character => WORD_CHARACTER.test(character));
  const matches = new Map<string, boolean[]>();
  const present = new Map<string, boolean>();
  const ends: Int32Array[] = [];
  const terminal = Int32Array.from({ length: size + 1 }, (_, i) => !word[i] ? i : -1);

  // Evaluate each fixed pattern backwards. Each state is visited once rather
  // than backtracking across overlapping repeated letters/symbol separators.
  // Greedy repetition/separators and term order retain the old regex policy.
  // O(code points * total dictionary characters), O(code points * term count).
  for (const pattern of PROFANITY_PATTERNS) {
    // An exact character-class absence check can safely skip a term: every
    // stage must occur somewhere. Unlike a literal-word prefilter, this keeps
    // every leetspeak, separator and Unicode variant eligible for detection.
    const eligible = pattern.every(variant => {
      if (!matches.has(variant.source)) {
        const unique = new Map<string, boolean>();
        const accepted = characters.map(character => {
          if (!unique.has(character)) unique.set(character, variant.test(character));
          return unique.get(character)!;
        });
        matches.set(variant.source, accepted);
        present.set(variant.source, accepted.some(Boolean));
      }
      return present.get(variant.source);
    });
    if (!eligible) continue;
    let following = terminal;
    for (let stage = pattern.length - 1; stage >= 0; stage--) {
      const variant = pattern[stage];
      const accepted = matches.get(variant.source)!;
      const repeated = new Int32Array(size + 1).fill(-1);
      for (let i = size - 1; i >= 0; i--) {
        if (accepted[i]) {
          repeated[i] = repeated[i + 1] >= 0 ? repeated[i + 1] : following[i + 1];
        }
      }
      if (stage === 0) {
        following = repeated;
      } else {
        const separated = new Int32Array(size + 1).fill(-1);
        for (let i = size - 1; i >= 0; i--) {
          separated[i] = separators[i] && separated[i + 1] >= 0
            ? separated[i + 1] : repeated[i];
        }
        following = separated;
      }
    }
    ends.push(following);
  }

  const output: string[] = [];
  for (let i = 0; i < size;) {
    const end = (i === 0 || !word[i - 1])
      ? ends.find(term => term[i] >= 0)?.[i] : undefined;
    if (end !== undefined) {
      output.push("***");
      i = end;
    } else {
      output.push(characters[i++]);
    }
  }
  return output.join("");
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
