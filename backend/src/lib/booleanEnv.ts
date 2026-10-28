/**
 * Strict boolean environment flags.
 *
 * Feature switches used to match only the exact lowercase literal "false", so
 * an operator who wrote `WORKER_ENABLED=FALSE` or `0` silently left the
 * feature running. Every flag now accepts the same trimmed, case-insensitive
 * spellings and refuses to start on anything else.
 */
const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/** Flags validated once at startup so a typo fails at boot, not mid-request. */
export const STARTUP_BOOLEAN_FLAGS = [
  { name: "WORKER_ENABLED", defaultValue: true },
  { name: "LIVE_DEPARTURE_ROUTES_ENABLED", defaultValue: true },
] as const;

/**
 * Reads `name` as a boolean: unset or blank uses `defaultValue`; otherwise
 * true/1/yes/on or false/0/no/off after trimming and lowercasing. Any other
 * value throws an error naming the variable (never echoing its value).
 */
export function readBooleanEnv(
  name: string,
  defaultValue: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = env[name]?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new RangeError(`${name} must be one of true/false, 1/0, yes/no or on/off.`);
}

/** Throws at startup when any documented boolean flag has an unrecognized value. */
export function assertBooleanEnvConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  for (const flag of STARTUP_BOOLEAN_FLAGS) readBooleanEnv(flag.name, flag.defaultValue, env);
}
