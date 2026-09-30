/** Convert a zero-based stop index to A...Z, AA...ZZ style labels. */
export function stopLabel(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) return "?";

  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
