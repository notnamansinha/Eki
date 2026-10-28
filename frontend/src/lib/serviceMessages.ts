/**
 * Inserts the admin-configured service start time into the "no buses" sub-message.
 * A function replacer keeps `$&`, `$'`, `` $` `` and `$$` in the stored time literal,
 * so the admin preview and the passenger empty state show exactly what was saved.
 */
export function formatNoBusesSubMessage(template: string, serviceStartTime: string): string {
  return template.replace("{time}", () => serviceStartTime);
}
