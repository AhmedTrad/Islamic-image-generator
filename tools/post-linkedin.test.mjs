import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardDate, checkConfig, createImagePost, readConfig } from './post-linkedin.mjs';

const config = { token: 'test-token', organizationId: '12345', version: '202610' };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const caption = 'قال رسول الله ﷺ\n\nصحيح البخاري';
const image = 'urn:li:image:test-image';
const postId = 'urn:li:share:987654321';

function fakeLinkedIn({ statuses = ['PROCESSING', 'AVAILABLE'], fail, uploadUrl = 'https://www.linkedin.com/dms-uploads/test', postHeaders = { 'x-restli-id': postId } } = {}) {
  const requests = [];
  let polls = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options });
    const json = (body) => Response.json(body);
    if (fail) {
      const failure = fail(url, options);
      if (failure) return failure;
    }
    if (url.endsWith('/images?action=initializeUpload')) return json({ value: { image, uploadUrl } });
    if (url === uploadUrl) return new Response(null, { status: 201 });
    if (url.endsWith(`/images/${encodeURIComponent(image)}`)) return json({ status: statuses[Math.min(polls++, statuses.length - 1)] });
    if (url.endsWith('/posts')) return new Response(null, { status: 201, headers: postHeaders });
    throw new Error(`Unexpected request: ${url}`);
  };
  return { requests, fetchImpl };
}

const publish = (mock, options = {}) => createImagePost({
  config, png, caption, title: 'Hadith bukhari-1', pollMs: 0, ...mock, ...options,
});

test('reads configuration, defaults to a supported API version and validates required settings', () => {
  assert.deepEqual(readConfig({ LINKEDIN_ACCESS_TOKEN: ' token ', LINKEDIN_ORGANIZATION_ID: ' 12345 ' }), { ...config, token: 'token' });
  assert.throws(() => checkConfig({ ...config, token: '' }), /LINKEDIN_ACCESS_TOKEN/);
  for (const organizationId of ['', 'example-page', 'urn:li:organization:123', 'https://linkedin.com/company/example', '0']) {
    assert.throws(() => checkConfig({ ...config, organizationId }), /numeric ID/);
  }
  for (const version of ['latest', '202613', '202600']) assert.throws(() => checkConfig({ ...config, version }), /YYYYMM/);
  checkConfig(config);
});

test('uses the Paris calendar date rather than the runner UTC date', () => {
  assert.equal(cardDate('Europe/Paris', new Date('2026-11-03T23:30:00Z')), '2026-11-04');
  assert.equal(cardDate('Europe/Paris', new Date('2026-07-03T22:30:00Z')), '2026-07-04');
});

test('uploads PNG bytes, waits for AVAILABLE and publishes exactly one organization image post', async () => {
  const mock = fakeLinkedIn();
  assert.deepEqual(await publish(mock), { id: postId, url: `https://www.linkedin.com/feed/update/${postId}/`, owner: 'urn:li:organization:12345' });
  assert.equal(mock.requests.length, 5);
  const [initialize, upload, firstPoll, secondPoll, post] = mock.requests;
  assert.equal(initialize.method, 'POST');
  assert.deepEqual(JSON.parse(initialize.body), { initializeUploadRequest: { owner: 'urn:li:organization:12345' } });
  assert.equal(initialize.headers.Authorization, 'Bearer test-token');
  assert.equal(initialize.headers['LinkedIn-Version'], '202610');
  assert.equal(initialize.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.equal(initialize.headers['Content-Type'], 'application/json');
  assert.equal(upload.method, 'PUT');
  assert.equal(upload.headers['Content-Type'], 'image/png');
  assert.deepEqual(upload.body, png);
  assert.equal(firstPoll.url, secondPoll.url);
  assert.equal(post.method, 'POST');
  assert.deepEqual(JSON.parse(post.body), {
    author: 'urn:li:organization:12345',
    commentary: caption,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: image, title: 'Hadith bukhari-1' } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
  assert.ok(mock.requests.every((request) => request.redirect === 'error' && request.signal instanceof AbortSignal));
});

test('never silently truncates hadiths and enforces the caption limit before contacting LinkedIn', async () => {
  for (const invalid of ['', ' ', 'x'.repeat(3001)]) {
    const mock = fakeLinkedIn();
    await assert.rejects(publish(mock, { caption: invalid }), /1 to 3000/);
    assert.equal(mock.requests.length, 0);
  }
  await publish(fakeLinkedIn(), { caption: 'x'.repeat(3000) });
  await publish(fakeLinkedIn(), { caption: '😀'.repeat(3000) });
  await assert.rejects(publish(fakeLinkedIn(), { png: Buffer.alloc(0) }), /PNG/);
});

test('does not send credentials or image bytes to an unexpected upload host', async () => {
  for (const uploadUrl of ['https://evil.example/upload', 'https://notlinkedin.com/upload', 'http://www.linkedin.com/upload', 'https://user:password@www.linkedin.com/upload']) {
    const mock = fakeLinkedIn({ uploadUrl });
    await assert.rejects(publish(mock), /unexpected upload address/);
    assert.equal(mock.requests.length, 1);
  }
});

test('explains expired tokens, missing permissions, throttling and retired API versions', async () => {
  for (const [status, message] of [[401, /expired/], [403, /w_organization_social/], [429, /rate-limiting/], [426, /LINKEDIN_API_VERSION/]]) {
    const mock = fakeLinkedIn({ fail: () => new Response('private response body', { status }) });
    await assert.rejects(publish(mock), (err) => {
      assert.match(err.message, message);
      assert.ok(!err.message.includes('private response body'));
      return true;
    });
    assert.equal(mock.requests.length, 1);
  }
});

test('never publishes when upload or processing fails, times out or returns an unknown state', async () => {
  for (const options of [{ statuses: ['PROCESSING_FAILED'] }, { statuses: ['PROCESSING'] }, { statuses: ['UNKNOWN'] },
    { fail: (url) => url.includes('/dms-uploads/') && new Response(null, { status: 500 }) }]) {
    const mock = fakeLinkedIn(options);
    await assert.rejects(publish(mock, { waitMs: 0 }), /process|status|HTTP 500/);
    assert.ok(!mock.requests.some(({ url }) => url.endsWith('/posts')));
  }
});

test('does not retry a publish request after an ambiguous network failure', async () => {
  const mock = fakeLinkedIn({ fail: (url) => {
    if (url.endsWith('/posts')) throw new TypeError('Network failure');
  } });
  await assert.rejects(publish(mock), /check the Page before retrying/);
  assert.equal(mock.requests.filter(({ url }) => url.endsWith('/posts')).length, 1);
});

test('requires a confirmed LinkedIn post ID rather than reporting false success', async () => {
  await assert.rejects(publish(fakeLinkedIn({ postHeaders: {} })), /confirmed post ID/);
  await assert.rejects(publish(fakeLinkedIn({ postHeaders: { 'x-restli-id': 'unexpected' } })), /confirmed post ID/);
  const mock = fakeLinkedIn({ postHeaders: { 'x-restli-id': 'urn:li:ugcPost:123' } });
  assert.equal((await publish(mock)).id, 'urn:li:ugcPost:123');
});

test('CLI validates credentials before loading the renderer and rejects conflicting options', () => {
  const cli = fileURLToPath(new URL('./post-linkedin.mjs', import.meta.url));
  const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LINKEDIN_ACCESS_TOKEN: '', LINKEDIN_ORGANIZATION_ID: '', ...env },
  });
  const missing = run(['--check-config']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /LINKEDIN_ACCESS_TOKEN/);
  const valid = run(['--check-config'], { LINKEDIN_ACCESS_TOKEN: config.token, LINKEDIN_ORGANIZATION_ID: config.organizationId });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(run(['--dry-run', '--send-only']).stderr, /cannot be combined/);
  assert.match(run(['--out']).stderr, /Missing value/);
});

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';

test('workflow guard skips confirmed posts, blocks uncertain attempts, allows new days and fails closed on Git errors', {
  skip: !existsSync(bash) && 'Git Bash or /bin/bash is required',
}, (context) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'linkedin-guard-'));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'output.txt');
  const summary = path.join(dir, 'summary.txt');
  const workflow = readFileSync(new URL('../.github/workflows/daily-linkedin.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const guard = workflow.split('      - name: Check today\'s posting state')[1].split('      - run: npm ci')[0];
  const script = guard.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  const stubs = `
    date() { echo 2026-11-04; }
    git() {
      case "$1" in
        ls-remote) if [ "$TEST_GIT_FAIL" = "remote" ]; then return 128; fi; printf '%s' "$TEST_REMOTE";;
        fetch) if [ "$TEST_GIT_FAIL" = "fetch" ]; then return 128; fi;;
        show) if [ "$TEST_GIT_FAIL" = "show" ]; then return 128; fi; printf '%s' "$TEST_STATE";;
        *) return 1;;
      esac
    }
  `;
  const run = (env = {}) => {
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stubs + script], {
      encoding: 'utf8',
      env: {
        ...process.env, CARD_TIMEZONE: 'Europe/Paris', STATE_BRANCH: 'daily-linkedin',
        LINKEDIN_ORGANIZATION_ID: config.organizationId,
        GITHUB_OUTPUT: output.replaceAll('\\', '/'), GITHUB_STEP_SUMMARY: summary.replaceAll('\\', '/'),
        FORCE: '', TEST_REMOTE: 'commit refs/heads/daily-linkedin', TEST_GIT_FAIL: '', TEST_STATE: '', ...env,
      },
    });
    result.stdout += readFileSync(output, 'utf8');
    return result;
  };
  const sent = run({ TEST_STATE: 'sent 2026-11-04 12345' });
  assert.equal(sent.status, 0, sent.stderr);
  assert.match(sent.stdout, /skip=true/);
  const pending = run({ TEST_STATE: 'pending 2026-11-04 12345' });
  assert.equal(pending.status, 1);
  assert.match(pending.stdout, /earlier attempt/);
  for (const env of [
    { TEST_REMOTE: '' },
    { TEST_STATE: 'sent 2026-11-03 12345' },
    { TEST_STATE: 'sent 2026-11-04 99999' },
    { TEST_STATE: 'pending 2026-11-04 12345', FORCE: 'true' },
    { TEST_STATE: 'sent 2026-11-04 12345', FORCE: 'true' },
  ]) {
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes('skip=true'));
  }
  for (const TEST_GIT_FAIL of ['remote', 'fetch', 'show']) {
    assert.notEqual(run({ TEST_GIT_FAIL }).status, 0, TEST_GIT_FAIL);
  }
  for (const TEST_STATE of ['', 'sent', 'unexpected 2026-11-04 12345']) {
    const invalid = run({ TEST_STATE });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /Invalid LinkedIn posting state/);
  }
});
