#!/usr/bin/env node
/* Import authentic hadiths from dorar.net into the Hadith card (index.html).

     npm run dorar -- search "إنما الأعمال بالنيات" [--page 2] [--any-book]
     npm run dorar -- add <result number | dorar.net/h/… link> --cat <ibadat|akhlaq|iman|dhikr> [--dry-run] [--force] [--any-book]
     npm run dorar -- bulk [--pages 2] [--dry-run]

   bulk searches dorar.net's official API (dorar.net/article/389) for every topic in tools/dorar-topics.mjs,
   limited to Sahih al-Bukhari and Sahih Muslim, and adds the complete sahih hadiths that fit the card.
   search and add read dorar.net's pages directly. With --api <url> or DORAR_API_URL they come from a
   dorar-hadith-api server you run (https://github.com/AhmedElTabarani/dorar-hadith-api) instead.
   Answers are cached for a day in tools/.cache. Requests to dorar.net go one at a time with a pause between
   them; if dorar.net refuses a request the tool stops and never tries to get around a block. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from './dorar-lib.mjs';
import { ApiUnreachableError, chooseSource } from './dorar-sources.mjs';
import { TOPICS } from './dorar-topics.mjs';

const CARD = fileURLToPath(new URL('../index.html', import.meta.url));
const CACHE_DIR = process.env.DORAR_CACHE_DIR || fileURLToPath(new URL('./.cache/', import.meta.url));
const LAST_SEARCH = path.join(CACHE_DIR, 'last-search.json');
const CACHE_HOURS = 24;
const REQUEST_GAP_MS = 1500;
const SITE_TIMEOUT_MS = 20000;
const API_TIMEOUT_MS = 65000; // the API itself waits up to 60 s for dorar.net (its EXPRESS_TIMEOUT)
const USER_AGENT = 'IslamicImageGenerator-DorarImport/1.0 (+https://github.com/AhmedTrad/Islamic-image-generator)';

const HELP = `Import authentic hadiths from dorar.net into the Hadith card (index.html).

  npm run dorar -- search "<words from the hadith>" [--page <n>] [--any-book]
      Lists Dorar's results. ✓ marks a sahih hadith from one of the main collections.

  npm run dorar -- add <result number | dorar.net/h/… link> --cat <${lib.CATEGORY_IDS.join('|')}>
      Adds a hadith (with Dorar's grade, source and a benefit from its explanation) to the card.
      --dry-run   show the entry without changing index.html
      --force     add it even if it isn't sahih or isn't from a main collection
      --any-book  accept sahih hadiths from any book, not only the main collections
      --card <path>  use another copy of the card page

  npm run dorar -- bulk [--pages <n>] [--dry-run]
      Searches dorar.net's official API for each topic in tools/dorar-topics.mjs (al-Bukhari and Muslim only,
      <n> pages of 15 results per topic, default 2) and adds every complete, vocalized sahih hadith that fits
      the card and isn't on it yet. The API has no explanations, so these cards have no الفائدة.

  Source (search and add):
      By default the tool reads dorar.net's pages directly.
      --api <url>   go through the dorar-hadith-api server at this address instead (or set DORAR_API_URL)
      --direct      read dorar.net directly even when DORAR_API_URL is set`;

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    const key = arg.slice(2);
    if (['page', 'pages', 'cat', 'card', 'api'].includes(key)) args[key] = argv[++i];
    else args[key] = true;
  }
  return args;
}

/* ─── HTTP with a day's cache ─── */

let lastRequestAt = 0;
async function cachedGet(url, { accept, ext, polite, timeoutMs }) {
  const cacheFile = path.join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + ext);
  try {
    if (Date.now() - (await stat(cacheFile)).mtimeMs < CACHE_HOURS * 3600e3) return { cached: true, text: await readFile(cacheFile, 'utf8') };
  } catch { /* not cached yet */ }

  if (polite) {
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'ar,en;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (response.ok) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, text);
  }
  return { cached: false, ok: response.ok, status: response.status, text };
}

// dorar.net pages.
async function fetchPage(url) {
  let result;
  try {
    result = await cachedGet(url, { accept: 'text/html', ext: '.html', polite: true, timeoutMs: SITE_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`Couldn't reach dorar.net (${err.cause?.code || err.name}). Check your internet connection and try again.`);
  }
  if (result.cached || result.ok) return result.text;
  if (result.status === 403) {
    throw new Error('dorar.net refused the request (HTTP 403). This tool does not try to get around that: run it from a normal home connection, or ask Dorar for access.');
  }
  if (result.status === 429) throw new Error('dorar.net asked for fewer requests (HTTP 429). Wait a while before trying again.');
  throw new Error(`dorar.net answered HTTP ${result.status} for ${url}`);
}

// dorar.net's official API (dorar_api.json), with the same pacing, cache and refusal handling as its pages.
async function fetchDorarApi(url) {
  let result;
  try {
    result = await cachedGet(url, { accept: 'application/json', ext: '.json', polite: true, timeoutMs: SITE_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`Couldn't reach dorar.net (${err.cause?.code || err.name}). Check your internet connection and try again.`);
  }
  if (!result.cached && !result.ok) {
    if (result.status === 403) throw new Error('dorar.net refused the request (HTTP 403). This tool does not try to get around that: run it from a normal home connection. Pages fetched so far are cached, so a rerun continues quickly.');
    if (result.status === 429) throw new Error('dorar.net asked for fewer requests (HTTP 429). Wait a while, then rerun; pages fetched so far are cached.');
    throw new Error(`dorar.net answered HTTP ${result.status} for ${url}`);
  }
  try {
    return JSON.parse(result.text);
  } catch {
    throw new lib.DorarFormatError("dorar.net's API sent something other than JSON.");
  }
}

// dorar-hadith-api answers: { status, metadata, data } on success, { status, message } on failure.
async function fetchJson(url) {
  let result;
  try {
    result = await cachedGet(url, { accept: 'application/json', ext: '.json', polite: false, timeoutMs: API_TIMEOUT_MS });
  } catch (err) {
    throw new ApiUnreachableError(`no dorar-hadith-api answered at ${new URL(url).origin} (${err.cause?.code || err.name})`);
  }
  let body = null;
  try { body = JSON.parse(result.text); } catch { /* reported below */ }
  if (result.cached || result.ok) {
    if (body === null || typeof body !== 'object') throw new lib.DorarFormatError(`dorar-hadith-api sent something other than JSON for ${url}`);
    return body;
  }
  const message = body?.message || result.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || `HTTP ${result.status}`;
  if (result.status === 429) {
    throw new Error(`dorar-hadith-api has used up its request allowance (${message}). It allows 100 requests a day per IP unless RATE_LIMIT_MAX in its .env says otherwise.`);
  }
  if (result.status === 404) throw new Error(`dorar-hadith-api: ${message}.`);
  if (result.status === 408 || result.status >= 500) {
    throw new Error(`dorar-hadith-api couldn't get the page from dorar.net (${message}). If dorar.net answers it with HTTP 403, see «Fetching through dorar-hadith-api» in the README.`);
  }
  throw new Error(`dorar-hadith-api answered HTTP ${result.status}: ${message}`);
}

function pickSource(args) {
  try {
    return chooseSource({ api: args.api, direct: args.direct, envUrl: process.env.DORAR_API_URL, fetchHtml: fetchPage, fetchJson });
  } catch (err) {
    throw new UsageError(err.message);
  }
}

/* ─── Commands ─── */

const oneLine = (text, max = 110) => (text.length > max ? text.slice(0, max) + '…' : text);

async function search(args, source) {
  const query = args._.slice(1).join(' ').trim();
  if (!query) throw new UsageError('Give some words from the hadith, e.g.  npm run dorar -- search "إنما الأعمال بالنيات"');
  const page = Math.max(1, Number(args.page) || 1);
  const { total, results } = await source.search(query, page);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(LAST_SEARCH, JSON.stringify({ query, page, source: source.name, results }, null, 2));

  if (!results.length) {
    console.log(`${source.name} has no results for «${query}»${page > 1 ? ` on page ${page}` : ''}.`);
    return;
  }
  console.log(`${source.name} · «${query}» · page ${page} · ${results.length} shown of ${total}\n`);
  results.forEach((h, i) => {
    const verdict = lib.assess(h, { anyBook: args['any-book'] });
    console.log(`${String(i + 1).padStart(2)}  ${verdict.ok ? '✓' : '✗'}  ${h.book} ${h.number} · ${h.mohdith} · ${h.grade} · ${h.rawi}${h.sharhId ? ' · شرح' : ''}`);
    console.log(`      ${oneLine(h.text)}`);
    if (!verdict.ok) console.log(`      not eligible: ${verdict.reasons.join('; ')}`);
  });
  console.log(`\nAdd one with:  npm run dorar -- add <number> --cat <${lib.CATEGORY_IDS.join('|')}>`);
}

async function loadFromLastSearch(number) {
  let last;
  try {
    last = JSON.parse(await readFile(LAST_SEARCH, 'utf8'));
  } catch {
    throw new UsageError('Run a search first, then add a result by its number.');
  }
  const hadith = last.results[number - 1];
  if (!hadith) throw new UsageError(`The last search («${last.query}») has no result ${number}.`);
  return hadith;
}

async function add(args, source) {
  const ref = args._[1];
  if (!ref) throw new UsageError('Say which hadith to add: a result number from the last search, or a dorar.net/h/… link.');
  if (!lib.CATEGORY_IDS.includes(args.cat)) throw new UsageError(`Choose a category with --cat ${lib.CATEGORY_IDS.join('|')}.`);

  let hadith;
  if (/^\d+$/.test(ref)) {
    hadith = await loadFromLastSearch(Number(ref));
  } else {
    const dorarId = lib.parseHadithRef(ref);
    if (!dorarId) throw new UsageError(`«${ref}» is neither a result number nor a dorar.net/h/… link.`);
    hadith = await source.hadith(dorarId);
  }

  const verdict = lib.assess(hadith, { anyBook: args['any-book'] });
  if (!verdict.ok && !args.force) throw new UsageError(`Not added: ${verdict.reasons.join('; ')}. Use --force to add it anyway.`);

  const cardPath = path.resolve(args.card || CARD);
  const html = await readFile(cardPath, 'utf8');
  const list = lib.readCardData(html);
  const duplicate = lib.findDuplicate(list, lib.toCardEntry(hadith, { cat: args.cat, sharh: null }));
  if (duplicate) throw new UsageError(`This hadith is already on the card as «${duplicate.id}».`);

  const sharh = hadith.sharhId ? lib.benefitFromSharh(await source.sharh(hadith.sharhId)) : null;
  const entry = lib.toCardEntry(hadith, { cat: args.cat, sharh });

  const notes = [];
  const ratio = lib.tashkeelRatio(entry.matn);
  if (ratio < 0.6) notes.push(`The matn is only partly vocalized (${Math.round(ratio * 100)}% of letters have tashkeel); the card style calls for full tashkeel.`);
  if (entry.matn.length > 320) notes.push('The matn is long, so the card will set it in a smaller size.');
  if (!sharh) notes.push('Dorar has no explanation for this hadith, so الفائدة is empty and the card hides it. Write one before publishing.');
  else if (!sharh.fromLessons) notes.push("الفائدة was taken from the opening of Dorar's explanation; check that it reads well on its own.");

  console.log(JSON.stringify(entry, null, 2));
  for (const note of notes) console.log('note: ' + note);
  if (args['dry-run']) {
    console.log('\nDry run: index.html was not changed.');
    return;
  }
  list.push(entry);
  await writeFile(cardPath, lib.writeCardData(html, list));
  const shown = path.relative(process.cwd(), cardPath);
  console.log(`\nAdded «${entry.id}» to ${shown.startsWith('..') ? cardPath : shown} (${list.length} hadiths). Read the matn and الفائدة once before publishing.`);
}

const API_PAGE_SIZE = 15;

async function bulk(args) {
  const pages = Math.min(5, Math.max(1, Number(args.pages) || 2));
  const cardPath = path.resolve(args.card || CARD);
  const html = await readFile(cardPath, 'utf8');
  const list = lib.readCardData(html);
  const topics = Object.entries(TOPICS).flatMap(([cat, words]) => words.map((q) => ({ cat, q })));
  const added = [];
  const skipped = {};
  console.log(`dorar.net official API · ${topics.length} topics · up to ${pages} page(s) each · al-Bukhari and Muslim only\n`);

  for (const [i, { cat, q }] of topics.entries()) {
    let found = 0;
    let taken = 0;
    for (let page = 1; page <= pages; page++) {
      const records = lib.parseApiResult(await fetchDorarApi(lib.apiSearchUrl(q, page)));
      found += records.length;
      const result = lib.selectForCard(records, { cat, existing: [...list, ...added] });
      added.push(...result.entries);
      taken += result.entries.length;
      for (const [reason, count] of Object.entries(result.skipped)) skipped[reason] = (skipped[reason] || 0) + count;
      if (records.length < API_PAGE_SIZE) break;
    }
    console.log(`${String(i + 1).padStart(2)}/${topics.length}  ${cat.padEnd(6)}  ${q}: ${found} found, ${taken} added`);
  }

  const byCat = Object.fromEntries(lib.CATEGORY_IDS.map((c) => [c, added.filter((e) => e.cat === c).length]));
  const narrations = added.filter((e) => e.lead === false).length;
  console.log(`\n${added.length} new hadiths (${lib.CATEGORY_IDS.map((c) => `${c} ${byCat[c]}`).join(', ')}); ${narrations} are narrations, shown without «قال رسول الله ﷺ:».`);
  console.log('Skipped: ' + (Object.entries(skipped).map(([reason, count]) => `${count} ${reason}`).join('; ') || 'none'));
  if (args['dry-run']) {
    console.log('\nDry run: index.html was not changed. First new entries:\n' + JSON.stringify(added.slice(0, 3), null, 2));
    return;
  }
  await writeFile(cardPath, lib.writeCardData(html, [...list, ...added]));
  console.log(`\nindex.html now holds ${list.length + added.length} hadiths.`);
}

const COMMANDS = { search, add, bulk };
const args = parseArgs(process.argv.slice(2));
const command = COMMANDS[args._[0]];
if (!command || args.help) {
  console.log(HELP);
  process.exit(command || args.help ? 0 : 1);
}
Promise.resolve()
  .then(() => command(args, pickSource(args)))
  .catch((err) => {
    console.error('Error: ' + err.message);
    if (err instanceof ApiUnreachableError) console.error('Start the dorar-hadith-api server (see README) or check the address. Without --api and DORAR_API_URL the tool reads dorar.net directly.');
    if (err instanceof lib.DorarFormatError) console.error('dorar.net or dorar-hadith-api may have changed its output; tools/dorar-lib.mjs needs updating.');
    process.exit(1);
  });
