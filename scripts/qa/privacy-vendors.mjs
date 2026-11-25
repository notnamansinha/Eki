/**
 * Sub-processor disclosure check (issue #524, qa/PRIVACY_VERIFICATION.md).
 *
 * Maps request hosts to the third-party services that receive visitor data,
 * reads the vendors a privacy notice declares, and compares the two. Pure
 * functions only; scripts/qa/run-privacy-hosts.mjs loads the pages.
 */

// First match wins, so specific hosts come before wildcards. `aliases` are the
// names a notice may use to declare the service (case-insensitive).
export const VENDORS = Object.freeze([
  { id: 'firebase-hosting', vendor: 'Google', service: 'Firebase Hosting (serves the web app)',
    hosts: ['*.web.app', '*.firebaseapp.com'], aliases: ['Firebase Hosting', 'Firebase'] },
  { id: 'firebase-auth', vendor: 'Google', service: 'Firebase Authentication',
    hosts: ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com'], aliases: ['Firebase Authentication', 'Firebase Auth', 'Firebase'] },
  { id: 'google-sign-in', vendor: 'Google', service: 'Sign in with Google',
    hosts: ['accounts.google.com', 'apis.google.com', 'oauth2.googleapis.com'], aliases: ['Sign in with Google', 'Google Sign-In', 'Google account'] },
  { id: 'firestore', vendor: 'Google', service: 'Cloud Firestore',
    hosts: ['firestore.googleapis.com'], aliases: ['Cloud Firestore', 'Firestore', 'Firebase'] },
  { id: 'firebase-rtdb', vendor: 'Google', service: 'Firebase Realtime Database',
    hosts: ['*.firebaseio.com', '*.firebasedatabase.app'], aliases: ['Realtime Database', 'Firebase'] },
  { id: 'cloud-run', vendor: 'Google', service: 'Cloud Run (Eki backend API)',
    hosts: ['*.run.app'], aliases: ['Cloud Run', 'Google Cloud'] },
  { id: 'google-maps', vendor: 'Google', service: 'Google Maps Platform',
    hosts: ['maps.googleapis.com', 'maps.gstatic.com', '*.ggpht.com', 'mapsresources-pa.googleapis.com', 'places.googleapis.com', 'routes.googleapis.com'],
    aliases: ['Google Maps', 'Maps Platform'] },
  { id: 'google-fonts', vendor: 'Google', service: 'Google Fonts', hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'], aliases: ['Google Fonts'] },
  { id: 'google-user-content', vendor: 'Google', service: 'Google account photos', hosts: ['*.googleusercontent.com'],
    aliases: ['Google account', 'Sign in with Google'] },
  { id: 'google-static', vendor: 'Google', service: 'Google static content (SDK and sign-in scripts)', hosts: ['*.gstatic.com'],
    aliases: ['Sign in with Google', 'Google Sign-In', 'Firebase'] },
  { id: 'google-apis', vendor: 'Google', service: 'Other Google APIs', hosts: ['*.googleapis.com'], aliases: ['Google Cloud', 'Firebase'] },
]);

const hostPattern = pattern => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+(?:\\.[a-z0-9-]+)*')}$`);
const compiled = VENDORS.map(vendor => ({ vendor, patterns: vendor.hosts.map(hostPattern) }));

/** The vendor entry for a host name, or null. Loopback is the local static server, not a vendor. */
export function vendorForHost(host) {
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  if (['127.0.0.1', '::1', 'localhost'].includes(name)) return { id: 'local', vendor: 'none', service: 'Local static server' };
  return compiled.find(item => item.patterns.some(pattern => pattern.test(name)))?.vendor ?? null;
}

/** The privacy notice URL configured in frontend/src/config/university.ts ('' when unpublished). */
export function configuredNoticeUrl(universitySource) {
  const match = /\{\s*label:\s*"Privacy notice",\s*href:\s*"([^"]*)"\s*\}/.exec(universitySource);
  if (!match) throw new Error('UNIVERSITY_LINKS no longer has a "Privacy notice" entry');
  return match[1];
}

/** Vendor IDs a notice text declares, by alias. */
export function declaredVendors(noticeText) {
  const text = ` ${String(noticeText).toLowerCase().replace(/\s+/g, ' ')} `;
  return VENDORS.filter(vendor => vendor.aliases.some(alias => {
    const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`[^a-z0-9]${escaped}[^a-z0-9]`).test(text);
  })).map(vendor => vendor.id);
}

/** Host sources the Content-Security-Policy allows, per directive, without hashes and keywords. */
export function cspHostSources(cspValue) {
  const result = {};
  for (const directive of cspValue.split(';').map(part => part.trim()).filter(Boolean)) {
    const [name, ...sources] = directive.split(/\s+/);
    const hosts = sources.filter(source => /^(https?|wss):\/\//.test(source))
      .map(source => new URL(source.replace('*.', 'wildcard.')).hostname.replace(/^wildcard\./, '*.'));
    if (hosts.length) result[name] = [...new Set(hosts)];
  }
  return result;
}

/** Map a wildcard CSP host to a vendor by a representative name. */
export function vendorForCspHost(host) {
  return vendorForHost(host.replace(/^\*\./, 'x-csp-probe.'));
}

/**
 * Compare observed hosts with the declared vendors.
 * FAIL for an observed vendor the notice does not declare or a host no vendor
 * entry covers, and NO_NOTICE when there is no notice text to compare with;
 * WARN for a declared vendor that never loaded.
 */
export function evaluateDisclosure({ observedHosts, declared, noticeAvailable = true }) {
  const observed = new Map(); const unmapped = [];
  for (const host of observedHosts) {
    const vendor = vendorForHost(host);
    if (!vendor) { unmapped.push(host); continue; }
    if (vendor.id === 'local') continue;
    if (!observed.has(vendor.id)) observed.set(vendor.id, { id: vendor.id, vendor: vendor.vendor, service: vendor.service, hosts: [] });
    observed.get(vendor.id).hosts.push(host);
  }
  const vendors = [...observed.values()].map(entry => ({ ...entry, hosts: [...new Set(entry.hosts)].sort(), declared: declared.includes(entry.id) }));
  const undeclared = vendors.filter(entry => !entry.declared).map(entry => entry.id);
  const declaredNotLoaded = declared.filter(id => !observed.has(id));
  const verdict = unmapped.length ? 'UNMAPPED_HOSTS' : undeclared.length ? 'UNDECLARED_VENDORS' : noticeAvailable ? 'DISCLOSED' : 'NO_NOTICE';
  return { verdict, vendors, undeclared, unmapped: [...new Set(unmapped)].sort(), warnings: declaredNotLoaded.map(id => `declared vendor ${id} never loaded`) };
}

/**
 * Vendors the Content-Security-Policy permits that no observed request reached.
 * A host check says nothing about these: they load on screens it did not open.
 * `permitted` is a list of `{ vendor }` (null for an unmapped CSP host).
 */
export function unobservedVendors(permitted, observedVendorIds) {
  const observed = new Set(observedVendorIds);
  return [...new Set((permitted ?? []).map(item => item.vendor).filter(id => id && id !== 'local' && !observed.has(id)))].sort();
}

/** Public routes of the static export that need no sign-in. /privacy and /terms show whether such pages exist. */
export const PUBLIC_ROUTES = Object.freeze(['/', '/install', '/passenger', '/admin', '/feedback', '/privacy', '/terms']);
export const LIVE_ORIGIN = 'https://bustrack-be165.web.app';
