import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportedInlineScriptHashes, globalCspHeader, withInlineScriptHashes } from '../inline-script-hashes.mjs';

/** The one change a clean tree may carry; QA evidence lists it in `ignoredChanges`. */
export const GENERATED_CSP_HASHES = 'firebase.json (generated CSP hashes)';

/** How `git status --porcelain` lists firebase.json changed in the working copy only. */
const UNSTAGED_FIREBASE_JSON = ' M firebase.json';

const git = (root, args, input) => execFileSync('git', args,
  { cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });

/**
 * True when firebase.json differs from HEAD only in the CSP inline-script
 * hashes that scripts/update-csp.mjs writes for the current frontend/out. The
 * expected file is HEAD's with only those hashes replaced; it is compared with
 * the working copy as git would store both, so a CRLF checkout is neither a
 * change nor hides one. Anything unexpected, including a missing export or a
 * file mode change, is a real change.
 */
function onlyGeneratedCspHashes(root) {
  try {
    // Status paths are relative to the top level, whichever directory asked.
    const top = git(root, ['rev-parse', '--show-toplevel']).trim();
    // A mode change is listed as " M" as well; the content checks below cannot see it.
    const [indexMode, fileMode] = git(top, ['diff-files', '--', 'firebase.json']).slice(1).split(' ');
    if (!indexMode || indexMode !== fileMode) return false;
    const committedText = git(top, ['cat-file', 'blob', 'HEAD:firebase.json']);
    const committed = globalCspHeader(JSON.parse(committedText))?.value;
    const current = globalCspHeader(JSON.parse(readFileSync(resolve(top, 'firebase.json'), 'utf8')))?.value;
    if (typeof committed !== 'string' || typeof current !== 'string' || committed === current) return false;
    const hashes = exportedInlineScriptHashes(resolve(top, 'frontend/out'));
    if (!hashes.length || withInlineScriptHashes(committed, hashes) !== current) return false;
    const parts = committedText.split(JSON.stringify(committed));
    if (parts.length !== 2) return false;
    const expected = parts.join(JSON.stringify(current));
    return git(top, ['hash-object', '--path=firebase.json', '--stdin'], expected)
      === git(top, ['hash-object', '--', 'firebase.json']);
  } catch {
    return false;
  }
}

/**
 * Whether the working tree differs from HEAD, as every QA report records it.
 * Any staged, modified, deleted or untracked path is dirty, with one
 * exception: an unstaged firebase.json whose only change is the generated CSP
 * hashes that `npm run build` writes. That exception is named in
 * `ignoredChanges`, so the evidence shows it.
 */
export function workingTreeState(root) {
  const entries = git(root, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const ignoredChanges = entries.includes(UNSTAGED_FIREBASE_JSON) && onlyGeneratedCspHashes(root) ? [GENERATED_CSP_HASHES] : [];
  const counted = ignoredChanges.length ? entries.filter(entry => entry !== UNSTAGED_FIREBASE_JSON) : entries;
  return { dirty: counted.length > 0, ignoredChanges };
}

/** `false`, `true`, or `false (ignored: …)` for report text. */
export function describeDirty({ dirty, ignoredChanges = [] }) {
  return ignoredChanges.length ? `${dirty} (ignored: ${ignoredChanges.join(', ')})` : String(dirty);
}
