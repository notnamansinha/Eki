/**
 * Synthetic-value markers for the passenger deletion check
 * (qa/PRIVACY_VERIFICATION.md, Section 4.1): what counts as a leaked value in
 * a database sweep or a log, and how a log is redacted. Pure functions.
 */

/** Distinctive synthetic values for one seeded account, by category. */
export function markersFor(identity) {
  const markers = { uid: [identity.uid], email: [identity.email], name: [identity.displayName],
    photo: identity.photoURL ? [identity.photoURL] : [], coordinates: identity.coordinates ?? [],
    message: identity.messages ?? [], feedback: identity.feedback ? [identity.feedback] : [],
    secret: identity.secrets ?? [] };
  return Object.fromEntries(Object.entries(markers).map(([key, values]) => [key, values.filter(value => typeof value === 'string' && value.length >= 6)]));
}

const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /\bBearer\s+(?!eyJ)[A-Za-z0-9._-]{20,}/g; // a JWT is counted once, by TOKEN_PATTERN

/** Categories of markers found in `text`; `token` also catches any JWT or bearer value. */
export function scanText(text, markers) {
  const found = {};
  for (const [category, values] of Object.entries(markers)) {
    const count = values.reduce((sum, value) => sum + text.split(value).length - 1, 0);
    if (count) found[category] = count;
  }
  const tokens = (text.match(TOKEN_PATTERN)?.length ?? 0) + (text.match(BEARER_PATTERN)?.length ?? 0);
  if (tokens) found.token = tokens;
  return found;
}

/** Scan a log line by line; returns hit counts and the first line numbers, never the text. */
export function scanLog(text, markers, { maxLines = 20 } = {}) {
  const totals = {}; const lines = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const found = scanText(line, markers);
    if (!Object.keys(found).length) return;
    for (const [category, count] of Object.entries(found)) totals[category] = (totals[category] ?? 0) + count;
    if (lines.length < maxLines) lines.push({ line: index + 1, categories: Object.keys(found).sort() });
  });
  return { lineCount: text ? text.split(/\r?\n/).length : 0, totals, lines };
}

/** Replace every marker and token in `text` with its category label. */
export function redactText(text, markers) {
  let result = text;
  const pairs = Object.entries(markers).flatMap(([category, values]) => values.map(value => [value, `<${category}>`]))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [value, label] of pairs) result = result.split(value).join(label);
  return result.replace(TOKEN_PATTERN, '<token>').replace(BEARER_PATTERN, 'Bearer <token>');
}
