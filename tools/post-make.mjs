#!/usr/bin/env node
/* Daily Pin through Make (make.com): Make's own Pinterest connection creates the Pin, so no Pinterest
   developer app is needed. Run by .github/workflows/daily-pin.yml in two steps around publishing the image:

     npm run pin -- prepare [--out out] [--id <hadith-id>]
         Renders the day's card to <out>/pin.png and writes the Pin's text to <out>/pin.json.
     npm run pin -- send --image-url <public address of pin.png> [--out out]
         Waits until the image can be downloaded, then sends the Pin to the Make webhook (MAKE_WEBHOOK_URL).

   Settings come from the environment:
     MAKE_WEBHOOK_URL   the address of the scenario's "Custom webhook" trigger (keep it secret)
     PIN_LINK           optional address the Pin links to; the hadith id is added as #id
     CAPTION_FOOTER     optional text after the description, such as hashtags
     CARD_SHOW_DATE=true  print the Hijri date on the card (left off by default: a Pin circulates for months)
     CARD_CREDIT, CARD_TIMEZONE, CARD_FORMAT   passed to the renderer (see tools/render-card.mjs) */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinFields } from './pinterest.mjs';

const IMAGE_WAIT_MS = 120000;
const IMAGE_POLL_MS = 3000;
const WEBHOOK_TIMEOUT_MS = 200000; // a scenario that ends with a "Webhook response" module answers after the Pin exists
const inActions = process.env.GITHUB_ACTIONS === 'true';

// The calendar date in the card's time zone, as YYYY-MM-DD.
export function pinDate(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function pinFileName(date, id) {
  return `pin-${date}-${String(id).replace(/[^A-Za-z0-9-]/g, '_')}.png`;
}

// GitHub's raw file host can take a few seconds to serve a just-pushed file; Pinterest must be able to fetch it.
export async function waitForImage(url, { timeoutMs = IMAGE_WAIT_MS, intervalMs = IMAGE_POLL_MS, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  for (;;) {
    try {
      const response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type') || '';
      if (response.ok && type.startsWith('image/')) return;
      last = response.ok ? `content type ${type || 'missing'}` : `HTTP ${response.status}`;
    } catch (err) {
      last = err.cause?.code || err.name;
    }
    if (Date.now() + intervalMs > deadline) throw new Error(`The image at ${url} still isn't available (${last}), so Pinterest couldn't fetch it.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function sendToMake({ webhookUrl, pin, imageUrl, fetchImpl = fetch }) {
  if (!/^https:\/\//.test(webhookUrl || '')) throw new Error('Set MAKE_WEBHOOK_URL to the address of your Make scenario\'s "Custom webhook" (it starts with https://).');
  const payload = {
    id: pin.id,
    date: pin.date,
    title: pin.title,
    description: pin.description,
    alt_text: pin.alt_text,
    link: pin.link || '',
    image_url: imageUrl,
  };
  let response;
  try {
    response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Couldn't reach the Make webhook (${err.cause?.code || err.name}).`);
  }
  const text = (await response.text()).trim();
  if (!response.ok) {
    const hint = response.status === 410 || /no scenario listening/i.test(text)
      ? ' The webhook no longer exists or no scenario uses it: copy the current address from the scenario into MAKE_WEBHOOK_URL.'
      : response.status === 429 ? ' Make is rate-limiting the webhook; try again later.' : '';
    throw new Error(`Make refused the Pin: ${text.slice(0, 200) || 'no details'} (HTTP ${response.status}).${hint}`);
  }
  // With a "Webhook response" module after "Create a Pin", Make answers with the new Pin's id.
  let pinId = null;
  try { pinId = JSON.parse(text)?.id ?? null; } catch { if (/^\d{6,}$/.test(text)) pinId = text; }
  return { accepted: /^accepted$/i.test(text), pinId: pinId ? String(pinId) : null, answer: text };
}

async function setOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { args._.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    if (['out', 'id', 'image-url'].includes(key)) args[key] = argv[++i];
    else if (key === 'help') args.help = true;
    else throw new Error(`Unknown option «${argv[i]}». Try --help.`);
  }
  return args;
}

async function prepare(args, outDir) {
  const { renderCard } = await import('./render-card.mjs');
  const timezone = process.env.CARD_TIMEZONE || undefined;
  const { entry, png, caption } = await renderCard({
    id: args.id,
    format: process.env.CARD_FORMAT || 'square',
    credit: process.env.CARD_CREDIT || undefined,
    footer: process.env.CAPTION_FOOTER,
    timezone,
    showDate: /^(1|true|yes)$/i.test(process.env.CARD_SHOW_DATE || ''),
  });
  const date = pinDate(timezone);
  const name = pinFileName(date, entry.id);
  const pin = { id: entry.id, date, name, ...pinFields({ entry, caption, link: (process.env.PIN_LINK || '').trim() }) };
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'pin.png'), png);
  await writeFile(path.join(outDir, 'pin.json'), JSON.stringify(pin, null, 2) + '\n');
  await setOutputs({ id: entry.id, date, name });
  console.log(`Rendered «${entry.id}» for ${date} (${Math.round(png.length / 1024)} KB) as ${name}.\n${JSON.stringify(pin, null, 2)}`);
}

async function send(args, outDir) {
  const imageUrl = args['image-url'];
  if (!/^https:\/\//.test(imageUrl || '')) throw new Error('Give the public https address of the image with --image-url.');
  const webhookUrl = (process.env.MAKE_WEBHOOK_URL || '').trim();
  if (!/^https:\/\//.test(webhookUrl)) throw new Error('Set MAKE_WEBHOOK_URL to the address of your Make scenario\'s "Custom webhook" (it starts with https://).');
  const pin = JSON.parse(await readFile(path.join(outDir, 'pin.json'), 'utf8'));
  await waitForImage(imageUrl);
  const result = await sendToMake({ webhookUrl, pin, imageUrl });
  const message = result.pinId
    ? `Pinned «${pin.id}»: https://www.pinterest.com/pin/${result.pinId}/`
    : `Make accepted «${pin.id}» (answer: ${result.answer || 'empty'}). Check the scenario's history in Make to see the Pin.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
}

const COMMANDS = { prepare, send };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = COMMANDS[args._[0]];
  if (!command || args.help) {
    console.log('npm run pin -- prepare [--out out] [--id <hadith-id>]\nnpm run pin -- send --image-url <https address of pin.png> [--out out]');
    if (!args.help) process.exitCode = 1;
    return;
  }
  await command(args, path.resolve(args.out || 'out'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`${inActions ? '::error::' : 'Error: '}${err.message}`);
    process.exit(1);
  });
}
