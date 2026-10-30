#!/usr/bin/env node
/* Render the day's Hadith card and pin it to a Pinterest board. Run daily by .github/workflows/daily-pin.yml.

     npm run post -- [--dry-run] [--force] [--id <hadith-id>] [--out <dir>]

   --dry-run  render the card and show the Pin's text without contacting Pinterest (or DRY_RUN=true)
   --force    pin even if today's card is already on the board (or FORCE=true)
   --id       pin a particular hadith instead of the day's one

   Settings come from the environment:
     PINTEREST_BOARD_ID        the board to pin to (npm run pinterest:auth lists them)
     PINTEREST_APP_ID, PINTEREST_APP_SECRET, PINTEREST_REFRESH_TOKEN
                               a fresh access token is fetched on every run
     PINTEREST_ACCESS_TOKEN    use this token as it is instead (for example a sandbox token)
     PINTEREST_SANDBOX=true    post to Pinterest's sandbox, the only place a Trial-access app can create Pins
     PINTEREST_REFRESH_TOKEN_FILE  where to write the refresh token Pinterest sends back, so it can be saved
     PIN_LINK                  optional address the Pin links to; the hadith id is added as #id
     CAPTION_FOOTER            optional text after the caption, such as hashtags
     CARD_CREDIT, CARD_TIMEZONE, CARD_FORMAT   passed to the renderer (see tools/render-card.mjs) */

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from './render-card.mjs';
import * as pinterest from './pinterest.mjs';

const DUPLICATE_WINDOW_HOURS = 20;
const inActions = process.env.GITHUB_ACTIONS === 'true';
const mask = (value) => { if (inActions && value) console.log(`::add-mask::${value}`); };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['id', 'out'].includes(key)) args[key] = argv[++i];
    else if (['dry-run', 'force', 'help'].includes(key)) args[key] = true;
    else throw new Error(`Unknown option «${argv[i]}». Try --help.`);
  }
  return args;
}

const flag = (name) => /^(1|true|yes)$/i.test(process.env[name] || '');

export function readConfig(env = process.env) {
  const sandbox = /^(1|true|yes)$/i.test(env.PINTEREST_SANDBOX || '');
  return {
    apiUrl: env.PINTEREST_API_URL || (sandbox ? pinterest.SANDBOX_API : pinterest.PRODUCTION_API),
    tokenUrl: env.PINTEREST_API_URL || pinterest.PRODUCTION_API,
    sandbox,
    boardId: (env.PINTEREST_BOARD_ID || '').trim(),
    accessToken: (env.PINTEREST_ACCESS_TOKEN || '').trim(),
    appId: (env.PINTEREST_APP_ID || '').trim(),
    appSecret: (env.PINTEREST_APP_SECRET || '').trim(),
    refreshToken: (env.PINTEREST_REFRESH_TOKEN || '').trim(),
    refreshTokenFile: env.PINTEREST_REFRESH_TOKEN_FILE || '',
    link: (env.PIN_LINK || '').trim(),
  };
}

function checkConfig(config) {
  const missing = [];
  if (!config.boardId) missing.push('PINTEREST_BOARD_ID');
  if (!config.accessToken) {
    for (const key of ['appId', 'appSecret', 'refreshToken']) {
      if (!config[key]) missing.push({ appId: 'PINTEREST_APP_ID', appSecret: 'PINTEREST_APP_SECRET', refreshToken: 'PINTEREST_REFRESH_TOKEN' }[key]);
    }
  }
  if (missing.length) throw new Error(`Missing settings: ${missing.join(', ')}. See «Posting to Pinterest every day» in the README.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run post -- [--dry-run] [--force] [--id <hadith-id>] [--out <dir>]   (settings: see the top of tools/post-daily.mjs)');
    return;
  }
  const dryRun = args['dry-run'] || flag('DRY_RUN');
  const force = args.force || flag('FORCE');
  const config = readConfig();
  if (!dryRun) checkConfig(config);
  mask(config.appSecret);
  mask(config.refreshToken);
  mask(config.accessToken);

  const { entry, png, caption } = await renderCard({
    id: args.id,
    format: process.env.CARD_FORMAT || 'square',
    credit: process.env.CARD_CREDIT || undefined,
    footer: process.env.CAPTION_FOOTER,
    timezone: process.env.CARD_TIMEZONE,
  });
  const outDir = path.resolve(args.out || 'out');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `hadith-${entry.id}.png`), png);
  await writeFile(path.join(outDir, `hadith-${entry.id}.txt`), caption + '\n');
  const fields = pinterest.pinFields({ entry, caption, link: config.link });
  console.log(`Rendered «${entry.id}» (${Math.round(png.length / 1024)} KB).`);

  if (dryRun) {
    console.log(`\nDry run: nothing was sent to Pinterest. The Pin would be:\n${JSON.stringify(fields, null, 2)}`);
    return;
  }

  let token = config.accessToken;
  if (!token) {
    const tokens = await pinterest.refreshAccessToken({ apiUrl: config.tokenUrl, appId: config.appId, appSecret: config.appSecret, refreshToken: config.refreshToken });
    mask(tokens.accessToken);
    mask(tokens.refreshToken);
    token = tokens.accessToken;
    // Save the refresh token Pinterest just sent before anything else can fail; the workflow stores it as a secret.
    if (config.refreshTokenFile) await writeFile(config.refreshTokenFile, tokens.refreshToken, { mode: 0o600 });
    if (tokens.refreshTokenExpiresAt) console.log(`Refresh token valid until ${new Date(tokens.refreshTokenExpiresAt * 1000).toISOString().slice(0, 10)}.`);
  }

  const call = { apiUrl: config.apiUrl, token, boardId: config.boardId };
  if (!force) {
    const since = Date.now() - DUPLICATE_WINDOW_HOURS * 3600e3;
    const duplicate = await pinterest.findRecentDuplicate({ ...call, title: fields.title, since });
    if (duplicate) {
      console.log(`Today's card is already on the board: https://www.pinterest.com/pin/${duplicate.id}/ . Nothing posted (use --force to post again).`);
      return;
    }
  }
  const pin = await pinterest.createPin({ ...call, fields, png });
  console.log(`Pinned «${entry.id}»${config.sandbox ? ' to the sandbox' : ''}: ${pin.url}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Pinned **${entry.id}**${config.sandbox ? ' (sandbox)' : ''}: ${pin.url}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`${inActions ? '::error::' : 'Error: '}${err.message}`);
    process.exit(1);
  });
}
