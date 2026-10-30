// Fixtures follow the JSON shapes documented by dorar-hadith-api (its README and api-docs/openapi.yaml);
// they are not saved live answers. The stub server runs in this process, so the tests need no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseSource, createApiSource, createSiteSource } from './dorar-sources.mjs';
import { writeCardData } from './dorar-lib.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('./dorar.mjs', import.meta.url));

const record = (over) => ({
  hadith: 'إنَّما الأعمالُ بالنِّيَّاتِ، وإنَّما لكلِّ امرئٍ ما نوى',
  rawi: 'عمر بن الخطاب', mohdith: 'البخاري', mohdithId: '256', book: 'صحيح البخاري', bookId: '6216',
  numberOrPage: '1', grade: '[صحيح]', explainGrade: '[صحيح]', takhrij: '', hadithId: 'a1b2c3d4',
  categories: [{ id: '7', name: 'النية' }],
  hasSimilarHadith: false, hasAlternateHadithSahih: false, hasUsulHadith: false,
  hasSharhMetadata: true, sharhMetadata: { id: '8209', isContainSharh: false, urlToGetSharh: '/v1/site/sharh/8209' },
  ...over,
});
const tirmidhi = record({ hadith: 'اتَّقِ اللهَ حيثُما كنتَ', rawi: 'أبو ذر الغفاري', mohdith: 'الترمذي', book: 'سنن الترمذي', numberOrPage: '1987', grade: 'حسن صحيح', explainGrade: 'حسن صحيح', hadithId: 'c9d0e1f2', hasSharhMetadata: false, sharhMetadata: undefined });
const weak = record({ hadith: 'حديثٌ آخر', mohdith: 'الألباني', book: 'السلسلة الضعيفة', numberOrPage: '55', grade: 'ضعيف', explainGrade: 'ضعيف', hadithId: 'e5f6a7b8', hasSharhMetadata: false, sharhMetadata: undefined });

const QUERY = '/v1/site/hadith/search?value=' + encodeURIComponent('اتق الله');
const answers = {
  [QUERY]: { metadata: { length: 3, total: 41, page: 1, totalPages: 2, numberOfNonSpecialist: 41, specialist: false, isCached: false }, data: [record(), weak, tirmidhi] },
  [QUERY + '&page=2']: { metadata: { length: 1, total: 41, page: 2, numberOfNonSpecialist: 41, isCached: false }, data: [tirmidhi] },
  '/v1/site/hadith/c9d0e1f2': { metadata: { length: 1, isCached: false }, data: { ...tirmidhi, hadithId: undefined } },
  '/v1/site/sharh/8209': {
    metadata: { isCached: false },
    data: { ...record(), sharhMetadata: { id: '8209', isContainSharh: true, urlToGetSharhById: '/v1/site/sharh/8209', sharh: 'النية محلها القلب. وفي الحديث: الحثُّ على الإخلاصِ في الأعمال، وفيه: أنَّ الأعمال بخواتيمها.' } },
  },
};

const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url.startsWith('/v1/site/hadith/limited')) {
    res.writeHead(429, { 'Content-Type': 'text/html' });
    return res.end('Too many requests, please try again later.');
  }
  const body = answers[req.url];
  if (!body) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'fail', message: 'Hadith not found' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'success', ...body }));
});

let base;
let tmp;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  tmp = await mkdtemp(path.join(tmpdir(), 'dorar-test-'));
});
after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

const plainFetchJson = async (url) => (await fetch(url)).json();

test('the API source asks the documented endpoints and maps the answers', async () => {
  const api = createApiSource({ baseUrl: base + '/', fetchJson: plainFetchJson });
  assert.equal(api.name, `dorar-hadith-api at ${base}`);
  const { total, results } = await api.search('اتق الله');
  assert.equal(total, 41);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    id: 'a1b2c3d4',
    text: 'إنَّما الأعمالُ بالنِّيَّاتِ، وإنَّما لكلِّ امرئٍ ما نوى',
    rawi: 'عمر بن الخطاب', mohdith: 'البخاري', book: 'صحيح البخاري', number: '1', grade: 'صحيح', takhrij: '', sharhId: '8209',
  });
  assert.equal(results[2].sharhId, null);
  assert.equal((await api.search('اتق الله', 2)).results.length, 1);
  const one = await api.hadith('c9d0e1f2');
  assert.equal(one.id, 'c9d0e1f2', 'falls back to the requested id');
  assert.equal(one.number, '1987');
  assert.match(await api.sharh('8209'), /^النية محلها القلب\. وفي الحديث/);
  assert.deepEqual(requests.slice(-4), [QUERY, QUERY + '&page=2', '/v1/site/hadith/c9d0e1f2', '/v1/site/sharh/8209']);
  assert.throws(() => createApiSource({ baseUrl: 'localhost:5000', fetchJson: plainFetchJson }), /http:\/\//);
});

test('the site source asks dorar.net pages', async () => {
  const urls = [];
  const site = createSiteSource({ fetchHtml: async (url) => { urls.push(url); return '<a aria-controls="home">(0)</a><div id="home"></div>'; } });
  assert.deepEqual(await site.search('اتق الله', 2), { total: 0, results: [] });
  assert.equal(urls[0], 'https://www.dorar.net/hadith/search?q=' + encodeURIComponent('اتق الله') + '&page=2');
});

test('the CLI searches and adds through an API server', async () => {
  const env = { ...process.env, DORAR_CACHE_DIR: path.join(tmp, 'cache-a'), DORAR_API_URL: '' };
  const { stdout } = await run(process.execPath, [CLI, 'search', 'اتق الله', '--api', base], { env });
  assert.ok(stdout.startsWith(`dorar-hadith-api at ${base} · «اتق الله» · page 1 · 3 shown of 41`), stdout);
  assert.match(stdout, / 3 {2}✓ {2}سنن الترمذي 1987/);
  assert.match(stdout, / 2 {2}✗ {2}السلسلة الضعيفة 55/);

  // A copy of the card with an empty hadith list, so the duplicate check (bukhari-1 is on the real card) stays out of the way.
  const card = path.join(tmp, 'card.html');
  await writeFile(card, writeCardData(await readFile(new URL('../index.html', import.meta.url), 'utf8'), []));
  const added = await run(process.execPath, [CLI, 'add', '1', '--cat', 'iman', '--dry-run', '--card', card], { env: { ...env, DORAR_API_URL: base } });
  const entry = JSON.parse(added.stdout.slice(0, added.stdout.indexOf('\n}') + 2));
  assert.equal(entry.id, 'bukhari-1');
  assert.equal(entry.sharh, 'في الحديث: الحثُّ على الإخلاصِ في الأعمال.');
  assert.equal(entry.sharhSource, 'الدرر السنية');
  assert.match(added.stdout, /Dry run/);

  const byLink = await run(process.execPath, [CLI, 'add', 'https://dorar.net/h/c9d0e1f2', '--cat', 'akhlaq', '--dry-run', '--card', card, '--api', base], { env });
  assert.match(byLink.stdout, /"id": "tirmidhi-1987"/);
  assert.match(byLink.stdout, /no explanation/);
});

test('the CLI reports API errors in plain words', async () => {
  const env = { ...process.env, DORAR_CACHE_DIR: path.join(tmp, 'cache-b'), DORAR_API_URL: '' };
  const fails = (argv) => run(process.execPath, [CLI, ...argv], { env }).then(
    () => assert.fail('expected the command to fail'),
    (err) => err.stderr,
  );
  assert.match(await fails(['add', 'https://dorar.net/h/missing1', '--cat', 'akhlaq', '--api', base]), /dorar-hadith-api: Hadith not found\./);
  assert.match(await fails(['add', 'https://dorar.net/h/limited1', '--cat', 'akhlaq', '--api', base]), /request allowance/);
  assert.match(await fails(['search', 'x', '--api', base, '--direct']), /contradict/);

  // An API address that answers nothing is an error, not a silent switch to dorar.net.
  const unreachable = await fails(['search', 'اتق الله', '--api', 'http://127.0.0.1:1']);
  assert.match(unreachable, /no dorar-hadith-api answered at http:\/\/127\.0\.0\.1:1/);
  assert.match(unreachable, /reads dorar\.net directly/);
  assert.match(await fails(['search', 'x', '--api', 'localhost:5000']), /must start with http/);
});

test('reads dorar.net unless an API address is given', () => {
  const pick = (opts) => chooseSource({ fetchHtml: async () => '', fetchJson: async () => ({}), ...opts }).name;
  assert.equal(pick({}), 'dorar.net');
  assert.equal(pick({ envUrl: '' }), 'dorar.net');
  assert.equal(pick({ envUrl: 'http://localhost:5000' }), 'dorar-hadith-api at http://localhost:5000');
  assert.equal(pick({ api: 'http://h:1/', envUrl: 'http://localhost:5000' }), 'dorar-hadith-api at http://h:1', '--api wins over the variable');
  assert.equal(pick({ direct: true, envUrl: 'http://localhost:5000' }), 'dorar.net', '--direct wins over the variable');
  assert.throws(() => pick({ direct: true, api: 'http://h:1' }), /contradict/);
});
