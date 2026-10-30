// A stand-in for Pinterest's API v5, following the request and answer shapes in its OpenAPI description (v5.28).
// It records every request, so the tests check exactly what would be sent. No network is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as pinterest from './pinterest.mjs';
import { readConfig } from './post-daily.mjs';

const APP = { appId: '1234567', appSecret: 's3cret' };
const NOW = Date.now();
const requests = [];
let boardPins = [];

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const record = { method: req.method, url: req.url, headers: req.headers, raw };
  requests.push(record);
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const auth = req.headers.authorization || '';

  if (req.url === '/v5/oauth/token' && req.method === 'POST') {
    if (auth !== 'Basic ' + Buffer.from(`${APP.appId}:${APP.appSecret}`).toString('base64')) return send(401, { code: 2, message: 'Authentication failed.' });
    const form = new URLSearchParams(raw);
    if (form.get('grant_type') === 'refresh_token') {
      if (form.get('refresh_token') === 'pinr.expired') return send(400, { code: 1, message: 'Invalid refresh token.' });
      if (form.get('refresh_token') === 'pinr.keep') return send(200, { access_token: 'pina.kept', expires_in: 2592000, token_type: 'bearer', scope: 'pins:write' });
      return send(200, { access_token: 'pina.fresh', expires_in: 2592000, refresh_token: 'pinr.next', refresh_token_expires_at: Math.floor(NOW / 1000) + 5184000, token_type: 'bearer', scope: 'boards:read,boards:write,pins:read,pins:write' });
    }
    if (form.get('grant_type') === 'authorization_code') return send(200, { access_token: 'pina.first', expires_in: 2592000, refresh_token: 'pinr.first', token_type: 'bearer', scope: 'boards:read,boards:write,pins:read,pins:write' });
    return send(400, { code: 1, message: 'Unsupported grant type.' });
  }
  if (auth === 'Bearer pina.revoked') return send(401, { code: 2, message: 'Authentication failed.' });
  if (auth === 'Bearer pina.trial') return send(403, { code: 29, message: 'You are not permitted to access that resource.' });
  if (req.url === '/v5/boards?page_size=100') return send(200, { items: [{ id: '111', name: 'أحاديث', privacy: 'PUBLIC' }, { id: '222', name: 'Drafts', privacy: 'SECRET' }], bookmark: null });
  if (req.url === '/v5/boards/111/pins?page_size=25') return send(200, { items: boardPins, bookmark: null });
  if (req.url === '/v5/pins' && req.method === 'POST') return send(201, { id: '987654321', board_id: JSON.parse(raw).board_id, created_at: new Date().toISOString() });
  return send(404, { code: 404, message: `No route ${req.method} ${req.url}` });
});

let apiUrl;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}/v5`;
});
after(() => server.close());

test('refreshes the access token with Basic auth and keeps the new refresh token', async () => {
  const tokens = await pinterest.refreshAccessToken({ apiUrl, ...APP, refreshToken: 'pinr.old' });
  assert.equal(tokens.accessToken, 'pina.fresh');
  assert.equal(tokens.refreshToken, 'pinr.next');
  assert.ok(tokens.refreshTokenExpiresAt > NOW / 1000);
  const sent = requests.at(-1);
  assert.equal(sent.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.raw)), { grant_type: 'refresh_token', refresh_token: 'pinr.old' });

  const kept = await pinterest.refreshAccessToken({ apiUrl, ...APP, refreshToken: 'pinr.keep' });
  assert.equal(kept.refreshToken, 'pinr.keep', 'keeps the old refresh token when none comes back');
});

test('explains token failures', async () => {
  await assert.rejects(pinterest.refreshAccessToken({ apiUrl, ...APP, refreshToken: 'pinr.expired' }), /Invalid refresh token\. \(HTTP 400\)/);
  await assert.rejects(pinterest.refreshAccessToken({ apiUrl, appId: APP.appId, appSecret: 'wrong', refreshToken: 'pinr.old' }), /HTTP 401\)\. The token is invalid or has expired: run «npm run pinterest:auth» again/);
  await assert.rejects(pinterest.refreshAccessToken({ apiUrl, appId: '', appSecret: '', refreshToken: 'x' }), /PINTEREST_APP_ID and PINTEREST_APP_SECRET/);
  await assert.rejects(pinterest.refreshAccessToken({ apiUrl, ...APP, refreshToken: '' }), /PINTEREST_REFRESH_TOKEN/);
  await assert.rejects(pinterest.refreshAccessToken({ apiUrl: 'http://127.0.0.1:1/v5', ...APP, refreshToken: 'x' }), /Couldn't reach Pinterest to refresh the access token/);
});

test('trades the sign-in code for tokens and builds the sign-in address', async () => {
  const tokens = await pinterest.exchangeCode({ apiUrl, ...APP, code: 'abc', redirectUri: 'http://localhost:8085/' });
  assert.equal(tokens.refreshToken, 'pinr.first');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).raw)), { grant_type: 'authorization_code', code: 'abc', redirect_uri: 'http://localhost:8085/' });

  const url = new URL(pinterest.authorizeUrl({ appId: APP.appId, redirectUri: 'http://localhost:8085/', state: 'xyz' }));
  assert.equal(url.origin + url.pathname, 'https://www.pinterest.com/oauth/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: APP.appId, redirect_uri: 'http://localhost:8085/', response_type: 'code', scope: 'boards:read,boards:write,pins:read,pins:write', state: 'xyz',
  });
});

test('lists boards', async () => {
  assert.deepEqual(await pinterest.listBoards({ apiUrl, token: 'pina.fresh' }), [
    { id: '111', name: 'أحاديث', privacy: 'PUBLIC' },
    { id: '222', name: 'Drafts', privacy: 'SECRET' },
  ]);
  assert.equal(requests.at(-1).headers.authorization, 'Bearer pina.fresh');
});

test('creates a Pin with the PNG as base64 and the card text', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const fields = { title: 'إنما الأعمال بالنيات', description: 'قال رسول الله ﷺ', alt_text: 'بطاقة حديث نبوي' };
  const pin = await pinterest.createPin({ apiUrl, token: 'pina.fresh', boardId: '111', fields, png });
  assert.deepEqual(pin, { id: '987654321', url: 'https://www.pinterest.com/pin/987654321/' });
  const sent = requests.at(-1);
  assert.equal(sent.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(sent.raw), {
    board_id: '111', ...fields,
    media_source: { source_type: 'image_base64', content_type: 'image/png', data: png.toString('base64') },
  });
  await assert.rejects(pinterest.createPin({ apiUrl, token: 'pina.trial', boardId: '111', fields, png }), /HTTP 403\)\. .*Trial access.*PINTEREST_SANDBOX=true/);
  await assert.rejects(pinterest.createPin({ apiUrl, token: 'pina.revoked', boardId: '111', fields, png }), /npm run pinterest:auth/);
});

test("finds today's Pin on the board, but not older or different ones", async () => {
  const hours = (h) => new Date(NOW - h * 3600e3).toISOString();
  boardPins = [
    { id: '1', title: 'حديث آخر', created_at: hours(1) },
    { id: '2', title: 'إنما الأعمال بالنيات', created_at: hours(30) },
  ];
  const look = { apiUrl, token: 'pina.fresh', boardId: '111', title: 'إنما الأعمال بالنيات', since: NOW - 20 * 3600e3 };
  assert.equal(await pinterest.findRecentDuplicate(look), null);
  boardPins.push({ id: '3', title: 'إنما الأعمال بالنيات', created_at: hours(2) });
  assert.equal((await pinterest.findRecentDuplicate(look)).id, '3');
});

test('fits the card text into Pinterest\'s limits', () => {
  const entry = { id: 'bukhari-1', matn: '«' + 'إنَّما الأعمالُ بالنِّيَّاتِ، '.repeat(12) + 'والله أعلم»', source: 'صحيح البخاري', refs: 'رقم (1)' };
  const caption = 'قال رسول الله ﷺ:\n' + 'نص طويل '.repeat(200);
  const fields = pinterest.pinFields({ entry, caption, link: 'https://example.org/hadith/' });
  assert.ok(Array.from(fields.title).length <= 100, fields.title);
  assert.ok(Array.from(fields.description).length <= 800);
  assert.ok(Array.from(fields.alt_text).length <= 500);
  assert.ok(fields.title.startsWith('إنَّما الأعمالُ') && fields.title.endsWith('…'), 'drops the guillemets and ends with an ellipsis');
  assert.ok(!/[،\s]…$/.test(fields.title), 'no comma or space before the ellipsis');
  assert.equal(fields.link, 'https://example.org/hadith/#bukhari-1');
  assert.equal(pinterest.pinFields({ entry, caption, link: 'https://example.org/#top' }).link, 'https://example.org/#top');
  assert.equal('link' in pinterest.pinFields({ entry, caption, link: '' }), false);
  assert.throws(() => pinterest.pinFields({ entry, caption, link: 'example.org' }), /PIN_LINK/);

  assert.equal(pinterest.clip('قصير', 100), 'قصير');
  assert.equal(pinterest.clip('واحد اثنان ثلاثة أربعة', 15), 'واحد اثنان…');
});

test('reads the posting settings, with the sandbox on its own host', () => {
  const base = { PINTEREST_BOARD_ID: ' 111 ', PINTEREST_APP_ID: '1', PINTEREST_APP_SECRET: '2', PINTEREST_REFRESH_TOKEN: '3' };
  const config = readConfig(base);
  assert.equal(config.apiUrl, 'https://api.pinterest.com/v5');
  assert.equal(config.boardId, '111');
  assert.equal(config.sandbox, false);
  const sandbox = readConfig({ ...base, PINTEREST_SANDBOX: 'true' });
  assert.equal(sandbox.apiUrl, 'https://api-sandbox.pinterest.com/v5');
  assert.equal(sandbox.tokenUrl, 'https://api.pinterest.com/v5', 'tokens are always issued by the production host');
});
