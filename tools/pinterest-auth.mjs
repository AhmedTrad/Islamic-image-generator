#!/usr/bin/env node
/* One-time Pinterest sign-in for the daily Pin. Run it on your own computer:

     npm run pinterest:auth -- [--port 8085] [--save-secrets]

   Needs PINTEREST_APP_ID and PINTEREST_APP_SECRET in the environment (or --app-id / --app-secret), and
   http://localhost:8085/ registered as a redirect URI of your app at developers.pinterest.com/apps.
   It opens Pinterest's sign-in page, receives the code on that address, trades it for tokens, and lists
   your boards so you can pick PINTEREST_BOARD_ID.
   --save-secrets  stores PINTEREST_APP_ID, PINTEREST_APP_SECRET and PINTEREST_REFRESH_TOKEN as secrets of
                   this GitHub repository with the gh CLI. Without it the refresh token is written to
                   tools/.cache/pinterest-refresh-token (git-ignored) and the gh commands are printed. */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as pinterest from './pinterest.mjs';

const TOKEN_FILE = fileURLToPath(new URL('./.cache/pinterest-refresh-token', import.meta.url));
const WAIT_MINUTES = 5;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['port', 'app-id', 'app-secret'].includes(key)) args[key] = argv[++i];
    else if (['save-secrets', 'help'].includes(key)) args[key] = true;
    else throw new Error(`Unknown option «${argv[i]}». Try --help.`);
  }
  return args;
}

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch { /* the address is printed anyway */ }
}

function waitForCode({ port, state }) {
  return new Promise((resolve, reject) => {
    const page = (res, status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3em">${text}</body>`);
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== '/') return page(res, 404, 'Not found.');
      if (url.searchParams.get('state') !== state) return page(res, 400, "This sign-in answer doesn't match the request. Start «npm run pinterest:auth» again.");
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        page(res, 400, `Pinterest didn't grant access (${error || 'no code'}). You can close this tab.`);
        finish(new Error(`Pinterest didn't grant access (${error || 'no code in the answer'}).`));
        return;
      }
      page(res, 200, 'Signed in. You can close this tab and go back to the terminal.');
      finish(null, code);
    });
    const timer = setTimeout(() => finish(new Error(`No answer from Pinterest within ${WAIT_MINUTES} minutes.`)), WAIT_MINUTES * 60e3);
    function finish(err, code) {
      clearTimeout(timer);
      server.close();
      if (err) reject(err); else resolve(code);
    }
    server.on('error', (err) => finish(new Error(`Couldn't listen on port ${port} (${err.code}). Choose another with --port, and register that address in your app too.`)));
    server.listen(port, '127.0.0.1');
  });
}

function ghSecretSet(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['secret', 'set', name], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', (err) => reject(new Error(`Couldn't run the gh CLI (${err.code}). Install it from https://cli.github.com and run «gh auth login».`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`gh secret set ${name} failed (exit code ${code}).`))));
    child.stdin.end(value);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run pinterest:auth -- [--port 8085] [--app-id <id>] [--app-secret <secret>] [--save-secrets]');
    return;
  }
  const appId = args['app-id'] || process.env.PINTEREST_APP_ID;
  const appSecret = args['app-secret'] || process.env.PINTEREST_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Set PINTEREST_APP_ID and PINTEREST_APP_SECRET (from your app at developers.pinterest.com/apps), or pass --app-id and --app-secret.');
  const port = Number(args.port) || 8085;
  const redirectUri = `http://localhost:${port}/`;
  const state = randomBytes(16).toString('hex');
  const url = pinterest.authorizeUrl({ appId, redirectUri, state });

  console.log(`Opening Pinterest's sign-in page. If no browser opens, visit:\n\n  ${url}\n\nThe app must list ${redirectUri} as a redirect URI.`);
  const codePromise = waitForCode({ port, state });
  openBrowser(url);
  const code = await codePromise;

  const tokens = await pinterest.exchangeCode({ appId, appSecret, code, redirectUri });
  if (!tokens.refreshToken) throw new Error("Pinterest didn't send a refresh token, so the daily job couldn't renew access.");
  const granted = tokens.scope.split(/[ ,]+/).filter(Boolean);
  const missing = pinterest.SCOPES.filter((s) => granted.length && !granted.includes(s));
  if (missing.length) console.log(`warning: Pinterest didn't grant ${missing.join(', ')}; posting may fail.`);
  const until = tokens.refreshTokenExpiresAt ? new Date(tokens.refreshTokenExpiresAt * 1000).toISOString().slice(0, 10) : 'in 60 days';
  console.log(`\nSigned in. The refresh token is valid until ${until}; the daily job renews it on every run.`);

  const boards = await pinterest.listBoards({ token: tokens.accessToken });
  if (boards.length) {
    console.log('\nYour boards (use the id as PINTEREST_BOARD_ID):');
    for (const b of boards) console.log(`  ${b.id}  ${b.name}${b.privacy && b.privacy !== 'PUBLIC' ? ` (${b.privacy.toLowerCase()})` : ''}`);
  } else {
    console.log('\nYou have no boards yet. Create one on pinterest.com, then run this again to see its id.');
  }

  if (args['save-secrets']) {
    await ghSecretSet('PINTEREST_APP_ID', appId);
    await ghSecretSet('PINTEREST_APP_SECRET', appSecret);
    await ghSecretSet('PINTEREST_REFRESH_TOKEN', tokens.refreshToken);
    console.log('\nSaved PINTEREST_APP_ID, PINTEREST_APP_SECRET and PINTEREST_REFRESH_TOKEN as repository secrets.');
  } else {
    await mkdir(fileURLToPath(new URL('./.cache/', import.meta.url)), { recursive: true });
    await writeFile(TOKEN_FILE, tokens.refreshToken, { mode: 0o600 });
    console.log(`\nThe refresh token is in tools/.cache/pinterest-refresh-token. Store the three secrets with:\n
  gh secret set PINTEREST_APP_ID --body "${appId}"
  gh secret set PINTEREST_APP_SECRET
  gh secret set PINTEREST_REFRESH_TOKEN < tools/.cache/pinterest-refresh-token`);
  }
  console.log('\nThen choose the board:  gh variable set PINTEREST_BOARD_ID --body "<board id>"');
}

main().catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
