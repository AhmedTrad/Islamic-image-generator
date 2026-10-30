#!/usr/bin/env node
/* Render the Hadith card (index.html) to a PNG in headless Chrome, with the page's own exporter,
   plus the caption to post with it.

     npm run render -- [--id <hadith-id>] [--format square|landscape] [--credit <text>] [--no-date] [--out <dir>]

   Without --id it renders the day's hadith, in CARD_TIMEZONE (default: this computer's time zone).
   Chrome or Edge is found in the usual places; set CHROME_PATH to use another browser binary.
   The page loads its fonts and Tailwind from the web, so this needs an internet connection. */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const CARD = fileURLToPath(new URL('../index.html', import.meta.url));
const PREFS_KEY = 'hadith-card:prefs';
const READY_TIMEOUT_MS = 60000;

const BROWSERS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

export function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) throw new Error(`CHROME_PATH points at ${process.env.CHROME_PATH}, which doesn't exist.`);
    return process.env.CHROME_PATH;
  }
  const found = (BROWSERS[process.platform] || []).find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found. Install Google Chrome, or set CHROME_PATH to a Chrome or Chromium binary.');
  return found;
}

// Caption for the post: the same text as the page's «نسخ النص» button, then الفائدة, then an optional footer.
export function buildCaption({ text, sharh, footer }) {
  return [text, sharh, footer].map((part) => (part || '').trim()).filter(Boolean).join('\n\n');
}

/**
 * @param {{ id?: string, format?: 'square'|'landscape', credit?: string, timezone?: string, footer?: string, showDate?: boolean }} options
 * @returns {Promise<{ entry: object, png: Buffer, caption: string }>}
 */
export async function renderCard({ id, format = 'square', credit, timezone, footer, showDate = true } = {}) {
  if (!['square', 'landscape'].includes(format)) throw new Error(`--format must be square or landscape (got «${format}»).`);
  const args = ['--no-first-run', '--no-default-browser-check'];
  // GitHub's Ubuntu runners don't allow Chrome's user-namespace sandbox. The page only loads this repo's
  // index.html, Google Fonts and the Tailwind CDN.
  if (process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux') args.push('--no-sandbox');
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args });
  try {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (err) => problems.push(err.message));
    if (timezone) await page.emulateTimezone(timezone);
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((key, prefs) => {
      try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (e) { /* the page falls back to its defaults */ }
    }, PREFS_KEY, { format, showDate, showSharh: true, ...(credit === undefined ? {} : { credit }) });

    const url = pathToFileURL(CARD).href + (id ? '#' + encodeURIComponent(id) : '');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: READY_TIMEOUT_MS });
    await page.waitForFunction(() => window.hadithCard, { timeout: READY_TIMEOUT_MS }).catch(() => {
      throw new Error(`index.html never finished loading${problems.length ? ': ' + problems.join('; ') : ''}.`);
    });

    const result = await page.evaluate(async () => {
      const card = window.hadithCard;
      await card.ready;
      const fonts = ['400 30px Amiri', '500 14px "Readex Pro"'].filter((spec) => !document.fonts.check(spec, 'بسم'));
      const styled = getComputedStyle(document.getElementById('frame')).paddingTop === '40px';
      const blob = await card.renderPNG();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { entry: card.current(), text: card.text(), missingFonts: fonts, styled, dataUrl };
    });

    if (result.missingFonts.length) throw new Error(`These web fonts didn't load: ${result.missingFonts.join(', ')}. Check the internet connection; the card would look wrong without them.`);
    if (!result.styled) throw new Error("Tailwind's styles didn't load from cdn.tailwindcss.com. Check the internet connection.");
    if (id && result.entry.id !== id) throw new Error(`index.html has no hadith with the id «${id}».`);
    if (problems.length) throw new Error(`index.html reported errors: ${problems.join('; ')}`);

    return {
      entry: result.entry,
      png: Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64'),
      caption: buildCaption({ text: result.text, sharh: result.entry.sharh, footer }),
    };
  } finally {
    await browser.close();
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['id', 'format', 'credit', 'out', 'footer'].includes(key)) args[key] = argv[++i];
    else if (['help', 'no-date'].includes(key)) args[key] = true;
    else throw new Error(`Unknown option «${argv[i]}». Try --help.`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run render -- [--id <hadith-id>] [--format square|landscape] [--credit <text>] [--footer <text>] [--no-date] [--out <dir>]');
    return;
  }
  const { entry, png, caption } = await renderCard({
    id: args.id,
    format: args.format,
    showDate: !args['no-date'],
    credit: args.credit ?? (process.env.CARD_CREDIT || undefined),
    footer: args.footer ?? process.env.CAPTION_FOOTER,
    timezone: process.env.CARD_TIMEZONE,
  });
  const outDir = path.resolve(args.out || 'out');
  await mkdir(outDir, { recursive: true });
  const image = path.join(outDir, `hadith-${entry.id}.png`);
  await writeFile(image, png);
  await writeFile(path.join(outDir, `hadith-${entry.id}.txt`), caption + '\n');
  console.log(`Rendered «${entry.id}» to ${path.relative(process.cwd(), image)} (${Math.round(png.length / 1024)} KB).\n\n${caption}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Error: ' + err.message);
    process.exit(1);
  });
}
