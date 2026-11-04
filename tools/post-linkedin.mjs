#!/usr/bin/env node
// Render the daily card, upload it to LinkedIn, then publish it on an organization Page.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const API_URL = 'https://api.linkedin.com/rest';
const inActions = process.env.GITHUB_ACTIONS === 'true';

export function readConfig(env = process.env) {
  return {
    token: (env.LINKEDIN_ACCESS_TOKEN || '').trim(),
    organizationId: (env.LINKEDIN_ORGANIZATION_ID || '').trim(),
    version: (env.LINKEDIN_API_VERSION || '202610').trim(),
  };
}

export function checkConfig(config) {
  if (!config.token) throw new Error('Set the LINKEDIN_ACCESS_TOKEN repository secret to a token with w_organization_social permission.');
  if (!/^[1-9]\d*$/.test(config.organizationId)) throw new Error('Set LINKEDIN_ORGANIZATION_ID to the numeric ID of your company Page (not its name or URL).');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(config.version)) throw new Error('LINKEDIN_API_VERSION must be a supported version in YYYYMM format.');
}

export function cardDate(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export async function createImagePost({
  config, png, caption, title, fetchImpl = fetch, pollMs = 2000, waitMs = 120000,
}) {
  checkConfig(config);
  if (!caption?.trim() || Array.from(caption).length > 3000) throw new Error('The LinkedIn caption must contain 1 to 3000 characters. Shorten CAPTION_FOOTER; the hadith will not be truncated.');
  if (!Buffer.isBuffer(png) || !png.length) throw new Error('The card PNG is missing or empty.');
  const owner = `urn:li:organization:${config.organizationId}`;
  const headers = {
    Authorization: `Bearer ${config.token}`,
    'LinkedIn-Version': config.version,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
  async function request(url, options, label) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch (err) {
      throw new Error(`${label}: network request failed (${err.cause?.code || err.name}). If publishing had started, check the Page before retrying; the post may already exist.`);
    }
    if (!response.ok) {
      const hint = response.status === 401 ? ' The token expired or was revoked; replace LINKEDIN_ACCESS_TOKEN.'
        : response.status === 403 ? ' Check Community Management API access, w_organization_social permission and the token owner\'s Page admin role.'
          : response.status === 429 ? ' LinkedIn is rate-limiting requests; retry later.'
            : response.status === 426 ? ' Set LINKEDIN_API_VERSION to a currently supported version.' : '';
      throw new Error(`${label}: HTTP ${response.status}.${hint}`);
    }
    return response;
  }
  const initialized = await request(`${API_URL}/images?action=initializeUpload`, {
    method: 'POST', headers, body: JSON.stringify({ initializeUploadRequest: { owner } }),
  }, 'Initialize LinkedIn image');
  const { value } = await initialized.json();
  const uploadUrl = new URL(value?.uploadUrl);
  if (uploadUrl.protocol !== 'https:' || !uploadUrl.hostname.endsWith('.linkedin.com') || uploadUrl.username || uploadUrl.password) {
    throw new Error('LinkedIn returned an unexpected upload address.');
  }
  if (!/^urn:li:image:[A-Za-z0-9_-]+$/.test(value?.image || '')) throw new Error('LinkedIn did not return an image URN.');
  await request(uploadUrl.href, {
    method: 'PUT', headers: { Authorization: headers.Authorization, 'Content-Type': 'image/png' }, body: png,
  }, 'Upload LinkedIn image');

  const deadline = Date.now() + waitMs;
  for (;;) {
    const response = await request(`${API_URL}/images/${encodeURIComponent(value.image)}`, { headers }, 'Check LinkedIn image');
    const image = await response.json();
    if (image.status === 'AVAILABLE') break;
    if (image.status === 'PROCESSING_FAILED') throw new Error('LinkedIn could not process the card image. No post was created.');
    if (!['WAITING_UPLOAD', 'PROCESSING'].includes(image.status)) throw new Error(`Unexpected LinkedIn image status: ${image.status}. No post was created.`);
    if (Date.now() + pollMs >= deadline) throw new Error('Timed out waiting for LinkedIn to process the image. No post was created.');
    await sleep(pollMs);
  }

  // Never retry this POST automatically: a timeout can happen after LinkedIn creates the post.
  const response = await request(`${API_URL}/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      author: owner,
      commentary: caption,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: value.image, title } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  }, 'Publish LinkedIn post');
  const id = response.headers.get('x-restli-id');
  if (response.status !== 201 || !/^urn:li:(share|ugcPost):\d+$/.test(id || '')) {
    throw new Error('LinkedIn did not return a confirmed post ID. Check the Page before retrying; the post may already exist.');
  }
  return { id, url: `https://www.linkedin.com/feed/update/${id}/`, owner };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['id', 'out'].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}.`);
      args[key] = argv[++i];
    } else if (['dry-run', 'send-only', 'check-config', 'help'].includes(key)) args[key] = true;
    else throw new Error(`Unknown option: ${argv[i]}. Try --help.`);
  }
  if (args['dry-run'] && args['send-only']) throw new Error('--dry-run and --send-only cannot be combined.');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run linkedin -- [--dry-run | --send-only | --check-config] [--id <hadith-id>] [--out out]');
    return;
  }
  const config = readConfig();
  if (!args['dry-run']) checkConfig(config);
  if (args['check-config']) return;
  const outDir = path.resolve(args.out || 'out');
  await mkdir(outDir, { recursive: true });
  let card;
  let png;
  if (args['send-only']) {
    card = JSON.parse(await readFile(path.join(outDir, 'linkedin-card.json'), 'utf8'));
    png = await readFile(path.join(outDir, 'linkedin-card.png'));
    if (card.date !== cardDate(process.env.CARD_TIMEZONE)) throw new Error('The prepared card is not from today. Render it again before posting.');
  } else {
    const { renderCard } = await import('./render-card.mjs');
    const rendered = await renderCard({
      id: args.id,
      format: process.env.CARD_FORMAT || 'square',
      credit: process.env.CARD_CREDIT || undefined,
      footer: process.env.CAPTION_FOOTER,
      timezone: process.env.CARD_TIMEZONE,
      showDate: /^(1|true|yes)$/i.test(process.env.CARD_SHOW_DATE || ''),
    });
    png = rendered.png;
    card = {
      id: rendered.entry.id,
      date: cardDate(process.env.CARD_TIMEZONE),
      title: `Hadith ${rendered.entry.id}`,
      caption: rendered.caption,
    };
    await writeFile(path.join(outDir, 'linkedin-card.png'), png);
    await writeFile(path.join(outDir, 'linkedin-card.json'), JSON.stringify(card, null, 2) + '\n');
    console.log(`Rendered ${card.id} for ${card.date} (${Math.round(png.length / 1024)} KB).`);
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `date=${card.date}\n`);
  if (args['dry-run']) {
    console.log(`Dry run: nothing was sent to LinkedIn.\n\n${card.caption}`);
    return;
  }
  const post = await createImagePost({ config, png, ...card });
  await writeFile(path.join(outDir, 'linkedin-post.json'), JSON.stringify({ ...post, date: card.date, hadithId: card.id }, null, 2) + '\n');
  console.log(`Published ${card.id}: ${post.url}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Published **${card.id}** on LinkedIn: ${post.url}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`${inActions ? '::error::' : 'Error: '}${err.message}`);
    process.exitCode = 1;
  });
}
