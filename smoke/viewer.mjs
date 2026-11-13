/**
 * Viewer smoke test.
 *
 * Proves the three things that were broken and that we fixed:
 *   1. a live viewer connects to a session-scoped cast socket
 *   2. screencast frames render (the URL bar reflects the live page)
 *   3. human input reaches the page (click focuses a field, typing lands)
 *
 * Usage: npm run smoke:viewer
 * Requires a Chrome/Chromium binary. Set CHROME_PATH to override.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.SMOKE_PORT ?? 3000);
const CDP_PORT = Number(process.env.CDP_REDIRECT_PORT ?? 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(existsSync);

if (!CHROME) {
  console.error('No Chrome binary found. Set CHROME_PATH.');
  process.exit(2);
}

// Hard ceiling so a wedged browser or socket can never hang CI for minutes.
const guard = setTimeout(() => {
  console.error('smoke test timed out');
  process.exit(3);
}, 180_000);

const FIXTURE = `<!doctype html><title>Steel viewer smoke</title>
<style>body{font:16px system-ui;margin:40px}label{display:block;margin:16px}input{width:320px;padding:8px}</style>
<form onsubmit="event.preventDefault()">
  <label>First name <input name="first" aria-label="First name"></label>
  <label>Email <input name="email" type="email" aria-label="Email address"></label>
  <button type="submit">Submit application</button>
</form>`;

const post = async (path, body) => {
  const response = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json;
};

const waitForHealth = async (timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE + '/v1/health')).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Steel did not become healthy');
};

const fixture = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(FIXTURE);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const fixtureAddress = fixture.address();
const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}/`;

const steel = spawn(process.execPath, ['api/build/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DOMAIN: `127.0.0.1:${PORT}`,
    CDP_DOMAIN: `127.0.0.1:${CDP_PORT}`,
    CDP_REDIRECT_PORT: String(CDP_PORT),
    CHROME_EXECUTABLE_PATH: CHROME,
    ENABLE_COMMANDS_API: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let steelLog = '';
steel.stdout.on('data', chunk => { steelLog += chunk; });
steel.stderr.on('data', chunk => { steelLog += chunk; });

let browser;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  await waitForHealth();

  const session = await post('/v1/sessions', { dimensions: { width: 1280, height: 800 } });

  const nav = await post(`/v1/sessions/${session.id}/commands`, {
    commands: [
      { command: 'navigate', url: fixtureUrl },
      { command: 'snapshot', interactive: true },
    ],
  });
  const snapshot = nav.results.at(-1).snapshot;
  const fieldRef = /textbox "First name"[^\n]*\[ref=([a-z0-9]+)\]/i.exec(snapshot)?.[1];
  check('session navigates and snapshots', Boolean(fieldRef), fieldRef ? `ref=${fieldRef}` : snapshot?.slice(0, 120));

  const boxResult = await post(`/v1/sessions/${session.id}/commands`, {
    commands: [{ command: 'get', what: 'box', target: fieldRef }],
  });
  const box = boxResult.results[0].value;

  const details = await (await fetch(`${BASE}/v1/sessions/${session.id}/live-details`)).json();
  const pageId = details.pages[0].id;

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const viewer = await browser.newPage();
  const viewerErrors = [];
  viewer.on('pageerror', error => viewerErrors.push(error.message));
  await viewer.goto(`${BASE}/v1/sessions/debug?pageId=${pageId}`, { waitUntil: 'domcontentloaded' });

  // 1 + 2: the viewer must receive metadata for the live page, which only happens on a working cast.
  await viewer.waitForFunction(
    expected => document.getElementById('url-text')?.value === expected,
    { timeout: 20_000 },
    fixtureUrl,
  );
  check('viewer connects and renders the live page', true);

  // Metadata arrives before the first frame; let the screencast paint so the viewer
  // knows the frame dimensions it must map clicks against.
  await sleep(1500);
  const paintedBytes = await viewer.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png').length : 0;
  });
  check('screencast has painted a frame', paintedBytes > 5_000, `dataUrl=${paintedBytes} bytes`);

  const canvas = await viewer.$('canvas');
  const rect = await canvas.boundingBox();
  check('screencast canvas has a size', Boolean(rect && rect.width > 0 && rect.height > 0),
    rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : 'no canvas');

  // 3: a real click and real keystrokes through the viewer must reach the page.
  await viewer.mouse.click(
    rect.x + ((box.x + box.width / 2) / 1280) * rect.width,
    rect.y + ((box.y + box.height / 2) / 800) * rect.height,
  );
  await sleep(300);
  await viewer.keyboard.type('Ada', { delay: 80 });
  await sleep(700);

  const probe = await post(`/v1/sessions/${session.id}/commands`, {
    commands: [{ command: 'eval', script: 'document.activeElement?.name + "|" + document.querySelector("input[name=first]")?.value' }],
  });
  check('human input reaches the page', probe.results[0].value === 'first|Ada', `got ${JSON.stringify(probe.results[0].value)}`);
  check('viewer had no page errors', viewerErrors.length === 0, viewerErrors.join('; '));

  await fetch(`${BASE}/v1/sessions/${session.id}`, { method: 'DELETE' }).catch(() => {});
} catch (error) {
  failures++;
  console.error('FAIL smoke run —', error instanceof Error ? error.message : error);
  if (steelLog) console.error(steelLog.split('\n').slice(-15).join('\n'));
} finally {
  await browser?.close().catch(() => {});
  // Keep-alive sockets from Steel's Chrome hold the fixture open; force them shut.
  await Promise.race([
    new Promise(resolve => {
      fixture.closeAllConnections?.();
      fixture.close(() => resolve());
    }),
    sleep(2000),
  ]);
  steel.kill('SIGTERM');
  await sleep(1000);
  if (!steel.killed) steel.kill('SIGKILL');
  clearTimeout(guard);
}

console.log(failures === 0 ? '\nviewer smoke test passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
