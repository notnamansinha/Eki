// Frozen testing41ffbc7 policy, used only on short differential inputs.
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


export function legacyCensorText(text: string): string { return text.replace(PROFANITY_REGEX, "***"); }
