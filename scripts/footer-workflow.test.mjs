import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { load } = createRequire(import.meta.url)('js-yaml');
const workflow = load(readFileSync(new URL('../.github/workflows/footer.yml', import.meta.url), 'utf8'));
const job = workflow.jobs['strip-footer'];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runScript = new AsyncFunction('context', 'github', 'core', job.steps[0].with.script);

async function run(body, { event = 'issue', snapshots, author = 'suryaraj09' } = {}) {
  const writes = [];
  const warnings = [];
  let reads = 0;
  const current = { body, user: { login: author }, updated_at: '2026-10-31T12:00:00Z' };
  await runScript({ repo: { owner: 'owner', repo: 'repo' }, payload: { [event]: { number: 42, body: 'stale event body' } } }, {
    rest: { issues: {
      get: async params => {
        assert.deepEqual(params, { owner: 'owner', repo: 'repo', issue_number: 42 });
        const data = snapshots?.[Math.min(reads, snapshots.length - 1)] ?? current;
        reads++;
        return { data };
      },
      update: async params => { writes.push(params); },
    } },
  }, { info() {}, warning(message) { warnings.push(message); } });
  return { writes, warnings, reads };
}

test('privileged fork trigger never checks out or runs PR code', () => {
  assert.deepEqual(workflow.on, {
    issues: { types: ['opened', 'edited'] },
    pull_request_target: { types: ['opened', 'edited'] },
  });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(job.permissions, { issues: 'write', 'pull-requests': 'write' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.concurrency.group, /github.event.issue.number \|\| github.event.pull_request.number/);
  assert.equal(job['timeout-minutes'], 2);
  assert.match(job.if, /issue.user.login == 'suryaraj09'/);
  assert.match(job.if, /pull_request.user.login == 'suryaraj09'/);
  assert.equal(job.steps.length, 1);
  assert.match(job.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}$/);
  assert.doesNotMatch(job.steps[0].with.script, /\$\{\{|eval\(|exec\(|require\(/);
});

for (const footer of [
  'Generated with Claude Code',
  '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  'Generated with [Claude Code](https://claude.ai/code)',
  '  generated WITH Claude Code  ',
]) {
  test(`removes terminal footer variant: ${footer}`, async () => {
    const result = await run(`Description\n\n${footer}\n\n`, { event: 'pull_request' });
    assert.deepEqual(result.writes, [{ owner: 'owner', repo: 'repo', issue_number: 42, body: 'Description' }]);
    assert.equal(result.reads, 2);
  });
}

for (const body of [
  '',
  'Description\n\n\nMore content  \n',
  '```js\nconst example = `a\n\n\n b`;\n```\n',
  'Generated with Claude Code\n\nExplanatory prose follows.',
  '```text\nGenerated with Claude Code\n```',
  '```text\nGenerated with Claude Code',
  '~~~text\nGenerated with Claude Code',
  '````text\n```\nGenerated with Claude Code',
  '```text\n~~~\nGenerated with Claude Code',
  '    Generated with Claude Code',
  '\tGenerated with Claude Code',
  'Description\r\n\r\n\r\nNo footer  \r\n',
]) {
  test(`preserves body content: ${JSON.stringify(body)}`, async () => {
    assert.deepEqual((await run(body)).writes, []);
  });
}

test('preserves internal blank lines, hard line breaks and CRLF outside footer', async () => {
  const prefix = 'Description  \r\n\r\n\r\n```text\r\nGenerated with Claude Code\r\n```  ';
  const result = await run(`${prefix}\r\n\r\nGenerated with Claude Code\r\n`);
  assert.equal(result.writes[0].body, prefix);
});

test('a footer-only body becomes empty', async () => {
  assert.equal((await run('Generated with Claude Code')).writes[0].body, '');
});

test('rechecks the live author before any write', async () => {
  assert.deepEqual((await run('Generated with Claude Code', { author: 'someone-else' })).writes, []);
});

test('a newer edit between reads is preserved and cleaned on retry', async () => {
  const earlier = { user: { login: 'suryaraj09' }, body: 'Old\n\nGenerated with Claude Code', updated_at: 'earlier' };
  const latest = { ...earlier, body: 'New edit\n\nGenerated with Claude Code', updated_at: 'later' };
  const result = await run('', { snapshots: [earlier, latest, latest, latest] });
  assert.equal(result.reads, 4);
  assert.equal(result.writes[0].body, 'New edit');
});

test('a newer edit with no footer is left unchanged', async () => {
  const earlier = { user: { login: 'suryaraj09' }, body: 'Old\n\nGenerated with Claude Code', updated_at: 'earlier' };
  const latest = { ...earlier, body: 'New content without footer', updated_at: 'later' };
  const result = await run('', { snapshots: [earlier, latest, latest] });
  assert.deepEqual(result.writes, []);
});

test('continuously changing descriptions exhaust retries without writing', async () => {
  const snapshots = Array.from({ length: 6 }, (_, index) => ({
    user: { login: 'suryaraj09' }, body: `Edit ${index}\n\nGenerated with Claude Code`, updated_at: `${index}`,
  }));
  const result = await run('', { snapshots });
  assert.equal(result.reads, 6);
  assert.deepEqual(result.writes, []);
  assert.equal(result.warnings.length, 1);
});
