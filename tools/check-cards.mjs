#!/usr/bin/env node
/* Checks that every hadith on the card fits, in both formats, by laying each one out in headless Chrome.

     npm run check-cards -- [--card <path>] [--json]

   The page shrinks the text down to its smallest size (18px) to make it fit; a hadith that still overflows
   is listed with its length. Exits with code 1 when any hadith overflows. */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './render-card.mjs';

const CARD = fileURLToPath(new URL('../index.html', import.meta.url));

export async function checkCards(cardPath = CARD) {
  const args = ['--no-first-run', '--no-default-browser-check'];
  if (process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux') args.push('--no-sandbox');
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.goto(pathToFileURL(cardPath).href, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => window.hadithCard, { timeout: 60000 });
    return await page.evaluate(async () => {
      await window.hadithCard.ready;
      const list = JSON.parse(document.getElementById('hadith-data').textContent);
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const overflowing = [];
      for (const format of ['square', 'landscape']) {
        const radio = document.querySelector(`input[name="format"][value="${format}"]`);
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        for (const h of list) {
          location.hash = h.id;
          window.dispatchEvent(new HashChangeEvent('hashchange'));
          await frame();
          const zone = document.getElementById('matnZone');
          const cs = getComputedStyle(zone);
          const room = zone.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
          const height = document.getElementById('matnInner').offsetHeight;
          if (height > room + 1) overflowing.push({ id: h.id, format, chars: Array.from(h.matn).length, over: Math.round(height - room) });
        }
      }
      return { checked: list.length, overflowing };
    });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cardArg = argv.indexOf('--card');
  const cardPath = path.resolve(cardArg !== -1 ? argv[cardArg + 1] : CARD);
  checkCards(cardPath).then(({ checked, overflowing }) => {
    if (argv.includes('--json')) console.log(JSON.stringify({ checked, overflowing }));
    else if (!overflowing.length) console.log(`All ${checked} hadiths fit the card in both formats.`);
    else {
      console.log(`${overflowing.length} layouts overflow (of ${checked} hadiths × 2 formats):`);
      for (const o of overflowing) console.log(`  ${o.id}  ${o.format}  ${o.chars} chars, ${o.over}px too tall`);
    }
    process.exitCode = overflowing.length ? 1 : 0;
  }).catch((err) => {
    console.error('Error: ' + err.message);
    process.exit(1);
  });
}
