#!/usr/bin/env node
/* Import authentic hadiths from dorar.net into the Hadith card (index.html).

     npm run dorar -- search "إنما الأعمال بالنيات" [--page 2] [--any-book]
     npm run dorar -- add <result number | dorar.net/h/… link> --cat <ibadat|akhlaq|iman|dhikr> [--dry-run] [--force] [--any-book]

   Requests are sent one at a time with a pause between them, and pages are cached for a day
   in tools/.cache. If dorar.net refuses a request the tool stops; it never tries to get around a block. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from './dorar-lib.mjs';

const CARD = fileURLToPath(new URL('../index.html', import.meta.url));
const CACHE_DIR = fileURLToPath(new URL('./.cache/', import.meta.url));
const LAST_SEARCH = path.join(CACHE_DIR, 'last-search.json');
const CACHE_HOURS = 24;
const REQUEST_GAP_MS = 1500;
const USER_AGENT = 'IslamicImageGenerator-DorarImport/1.0 (+https://github.com/AhmedTrad/Islamic-image-generator)';

const HELP = `Import authentic hadiths from dorar.net into the Hadith card (index.html).

  npm run dorar -- search "<words from the hadith>" [--page <n>] [--any-book]
      Lists dorar.net results. ✓ marks a sahih hadith from one of the main collections.

  npm run dorar -- add <result number | dorar.net/h/… link> --cat <${lib.CATEGORY_IDS.join('|')}>
      Adds a hadith (with Dorar's grade, source and a benefit from its explanation) to the card.
      --dry-run   show the entry without changing index.html
      --force     add it even if it isn't sahih or isn't from a main collection
      --any-book  accept sahih hadiths from any book, not only the main collections
      --card <path>  use another copy of the card page`;

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    const key = arg.slice(2);
    if (['page', 'cat', 'card'].includes(key)) args[key] = argv[++i];
    else args[key] = true;
  }
  return args;
}

let lastRequestAt = 0;
async function fetchPage(url) {
  const cacheFile = path.join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.html');
  try {
    if (Date.now() - (await stat(cacheFile)).mtimeMs < CACHE_HOURS * 3600e3) return await readFile(cacheFile, 'utf8');
  } catch { /* not cached yet */ }

  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'ar,en;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`Couldn't reach dorar.net (${err.cause?.code || err.name}). Check your internet connection and try again.`);
  }
  if (response.status === 403) {
    throw new Error('dorar.net refused the request (HTTP 403). This tool does not try to get around that: run it from a normal home connection, or ask Dorar for access.');
  }
  if (response.status === 429) throw new Error('dorar.net asked for fewer requests (HTTP 429). Wait a while before trying again.');
  if (!response.ok) throw new Error(`dorar.net answered HTTP ${response.status} for ${url}`);

  const html = await response.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, html);
  return html;
}

const oneLine = (text, max = 110) => (text.length > max ? text.slice(0, max) + '…' : text);

async function search(args) {
  const query = args._.slice(1).join(' ').trim();
  if (!query) throw new UsageError('Give some words from the hadith, e.g.  npm run dorar -- search "إنما الأعمال بالنيات"');
  const page = Math.max(1, Number(args.page) || 1);
  const url = `${lib.DORAR}/hadith/search?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
  const { total, results } = lib.parseSearchPage(await fetchPage(url));

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(LAST_SEARCH, JSON.stringify({ query, page, results }, null, 2));

  if (!results.length) {
    console.log(`dorar.net has no results for «${query}»${page > 1 ? ` on page ${page}` : ''}.`);
    return;
  }
  console.log(`dorar.net · «${query}» · page ${page} · ${results.length} shown of ${total}\n`);
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

async function add(args) {
  const ref = args._[1];
  if (!ref) throw new UsageError('Say which hadith to add: a result number from the last search, or a dorar.net/h/… link.');
  if (!lib.CATEGORY_IDS.includes(args.cat)) throw new UsageError(`Choose a category with --cat ${lib.CATEGORY_IDS.join('|')}.`);

  let hadith;
  if (/^\d+$/.test(ref)) {
    hadith = await loadFromLastSearch(Number(ref));
  } else {
    const dorarId = lib.parseHadithRef(ref);
    if (!dorarId) throw new UsageError(`«${ref}» is neither a result number nor a dorar.net/h/… link.`);
    hadith = lib.parseHadithPage(await fetchPage(`${lib.DORAR}/h/${dorarId}`), dorarId);
  }

  const verdict = lib.assess(hadith, { anyBook: args['any-book'] });
  if (!verdict.ok && !args.force) throw new UsageError(`Not added: ${verdict.reasons.join('; ')}. Use --force to add it anyway.`);

  const cardPath = path.resolve(args.card || CARD);
  const html = await readFile(cardPath, 'utf8');
  const list = lib.readCardData(html);
  const duplicate = lib.findDuplicate(list, lib.toCardEntry(hadith, { cat: args.cat, sharh: null }));
  if (duplicate) throw new UsageError(`This hadith is already on the card as «${duplicate.id}».`);

  const sharh = hadith.sharhId
    ? lib.benefitFromSharh(lib.parseSharhPage(await fetchPage(`${lib.DORAR}/hadith/sharh/${hadith.sharhId}`)))
    : null;
  const entry = lib.toCardEntry(hadith, { cat: args.cat, sharh });

  const notes = [];
  const ratio = lib.tashkeelRatio(entry.matn);
  if (ratio < 0.6) notes.push(`The matn is only partly vocalized (${Math.round(ratio * 100)}% of letters have tashkeel); the card style calls for full tashkeel.`);
  if (entry.matn.length > 320) notes.push('The matn is long, so the card will set it in a smaller size.');
  if (!sharh) notes.push('Dorar has no explanation for this hadith, so الفائدة is empty and the card hides it. Write one before publishing.');
  else if (!sharh.fromLessons) notes.push('الفائدة was taken from the opening of Dorar\'s explanation; check that it reads well on its own.');

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

const COMMANDS = { search, add };
const args = parseArgs(process.argv.slice(2));
const command = COMMANDS[args._[0]];
if (!command || args.help) {
  console.log(HELP);
  process.exit(command || args.help ? 0 : 1);
}
command(args).catch((err) => {
  console.error('Error: ' + err.message);
  if (err instanceof lib.DorarFormatError) console.error('dorar.net may have changed its page layout; tools/dorar-lib.mjs needs updating.');
  process.exit(1);
});
