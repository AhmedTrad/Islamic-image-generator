/* ─── Pinterest API v5 ───
   Token exchange and refresh, a same-day duplicate check, and Pin creation for the daily card.
   Endpoints and field limits follow Pinterest's OpenAPI description, v5.28
   (https://github.com/pinterest/api-description). Every function takes the fetch to use, so tests can stub it. */

export const PRODUCTION_API = 'https://api.pinterest.com/v5';
export const SANDBOX_API = 'https://api-sandbox.pinterest.com/v5';
export const AUTHORIZE_URL = 'https://www.pinterest.com/oauth/';
export const SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write'];
const LIMITS = { title: 100, description: 800, alt_text: 500, link: 2048 };
const TIMEOUT_MS = 60000;

export class PinterestError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

const HINTS = {
  401: ' The token is invalid or has expired: run «npm run pinterest:auth» again.',
  403: " The token is missing a permission, or the app only has Trial access, which can't create public Pins. Use the sandbox (PINTEREST_SANDBOX=true) until Pinterest grants Standard access.",
  429: ' Pinterest is rate-limiting this app. Try again later.',
};

async function call(fetchImpl, url, init, what) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new PinterestError(`Couldn't reach Pinterest to ${what} (${err.cause?.code || err.name}).`);
  }
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* reported below if it matters */ }
  if (!response.ok) {
    const detail = body?.message || text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'no details';
    throw new PinterestError(`Pinterest refused to ${what}: ${detail} (HTTP ${response.status}).${HINTS[response.status] || ''}`, { status: response.status });
  }
  if (body === null) throw new PinterestError(`Pinterest sent something other than JSON when asked to ${what}.`, { status: response.status });
  return body;
}

const basicAuth = (appId, appSecret) => 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64');

async function tokenRequest({ apiUrl = PRODUCTION_API, appId, appSecret, fields, fetchImpl = fetch, what }) {
  if (!appId || !appSecret) throw new PinterestError('Set PINTEREST_APP_ID and PINTEREST_APP_SECRET (from your app at developers.pinterest.com/apps).');
  const body = await call(fetchImpl, `${apiUrl}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(appId, appSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  }, what);
  if (!body.access_token) throw new PinterestError(`Pinterest's answer when asked to ${what} had no access token.`);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    refreshTokenExpiresAt: body.refresh_token_expires_at || null,
    scope: body.scope || '',
  };
}

// One-time: trade the code from Pinterest's sign-in page for tokens.
export function exchangeCode({ code, redirectUri, ...rest }) {
  return tokenRequest({ ...rest, fields: { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, what: 'exchange the sign-in code' });
}

// Daily: a fresh access token. Pinterest answers with a new continuous refresh token (valid 60 days) as well.
export async function refreshAccessToken({ refreshToken, ...rest }) {
  if (!refreshToken) throw new PinterestError('Set PINTEREST_REFRESH_TOKEN (run «npm run pinterest:auth» once to get it).');
  const tokens = await tokenRequest({ ...rest, fields: { grant_type: 'refresh_token', refresh_token: refreshToken }, what: 'refresh the access token' });
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken };
}

export function authorizeUrl({ appId, redirectUri, state }) {
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(','), state });
  return `${AUTHORIZE_URL}?${params}`;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

export async function listBoards({ apiUrl = PRODUCTION_API, token, fetchImpl = fetch }) {
  const body = await call(fetchImpl, `${apiUrl}/boards?page_size=100`, { headers: bearer(token) }, 'list your boards');
  return (body.items || []).map((b) => ({ id: b.id, name: b.name, privacy: b.privacy }));
}

// The card's Pin, if one with the same title went on the board since `since` (a re-run on the same day).
export async function findRecentDuplicate({ apiUrl = PRODUCTION_API, token, boardId, title, since, fetchImpl = fetch }) {
  const body = await call(fetchImpl, `${apiUrl}/boards/${encodeURIComponent(boardId)}/pins?page_size=25`, { headers: bearer(token) }, 'list the board\'s Pins');
  return (body.items || []).find((p) => p.title === title && Date.parse(p.created_at) >= since) || null;
}

export async function createPin({ apiUrl = PRODUCTION_API, token, boardId, fields, png, fetchImpl = fetch }) {
  const body = await call(fetchImpl, `${apiUrl}/pins`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: boardId,
      ...fields,
      media_source: { source_type: 'image_base64', content_type: 'image/png', data: png.toString('base64') },
    }),
  }, 'create the Pin');
  if (!body.id) throw new PinterestError("Pinterest's answer had no Pin id.");
  return { id: body.id, url: `https://www.pinterest.com/pin/${body.id}/` };
}

/* ─── Pin text ─── */

// Cut to `max` characters at a word boundary, with an ellipsis when something was dropped.
export function clip(text, max) {
  const chars = Array.from(String(text).trim());
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s،,.؛:]+$/, '') + '…';
}

export function pinFields({ entry, caption, link }) {
  const matn = entry.matn.replace(/^«/, '').replace(/»$/, '').trim();
  const fields = {
    title: clip(matn, LIMITS.title),
    description: clip(caption, LIMITS.description),
    alt_text: clip(`بطاقة حديث نبوي: ${matn} — ${entry.source}، ${entry.refs}`, LIMITS.alt_text),
  };
  if (link) {
    const url = link + (link.includes('#') ? '' : '#' + encodeURIComponent(entry.id));
    if (!/^https?:\/\//.test(url) || url.length > LIMITS.link) throw new PinterestError(`PIN_LINK must be an http(s) address under ${LIMITS.link} characters (got «${link}»).`);
    fields.link = url;
  }
  return fields;
}
