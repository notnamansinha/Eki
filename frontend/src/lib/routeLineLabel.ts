/** Short signage label for a route: "Line 7" for numbered lines, else initials. */
export function routeLineLabel(name: string) {
  const code = /^(?:line[ -]+)?(\d+[a-z]?)$/i.exec(name.trim())?.[1];
  if (code) return `Line ${code.toUpperCase()}`;
  const words = name.trim().split(/\s+/);
  const short = words.length > 1
    ? words.slice(0, 4).map(word => Array.from(word)[0]).join("")
    : Array.from(words[0]).slice(0, 6).join("");
  return short.toUpperCase();
}
