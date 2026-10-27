/**
 * FluentSSH UI end-to-end test (Playwright + installed Chrome).
 *
 * Prerequisites:
 *   1) pnpm exec tsx scripts/mock-lab.ts            (mock SSH/SFTP/HTTP target; writes tests/.artifacts/mock-lab.json)
 *   2) temp FluentSSH server on :4340 with data seeded by scripts/e2e-setup.mjs and a built web/dist
 *
 * Run: QA_BASE=http://127.0.0.1:4340 node tests/ui.test.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4340';
const OUT = path.resolve('tests/.artifacts');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

const seed = JSON.parse(fs.readFileSync(path.join(OUT, 'e2e-seed.json'), 'utf8'));
const lab = JSON.parse(fs.readFileSync(path.join(OUT, 'mock-lab.json'), 'utf8'));
const results = [];
const consoleErrors = [];
const pageErrors = [];
let requestContext;

async function api(pathname, init = {}) {
  const response = await requestContext.fetch(`${BASE}/api${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`API ${pathname} ${response.status}: ${text}`);
  return data;
}

async function check(name, fn) {
  const started = Date.now();
  process.stdout.write(`  ▸ ${name} … `);
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, detail: error });
    console.log('FAILED');
    throw error;
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
requestContext = context.request;
await requestContext.get(`${BASE}/api/bootstrap`);
// Clean up sessions left by earlier runs so tab hydration is deterministic.
try {
  const existing = await (await requestContext.get(`${BASE}/api/sessions`)).json();
  for (const session of existing.sessions ?? []) {
    await requestContext.delete(`${BASE}/api/sessions/${session.id}`);
  }
} catch {
  // first run may have no sessions
}
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

const screenshot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `e2e-${name}.png`) });
};

async function terminalText() {
  return (await page.locator('[data-testid="terminal-host"] .xterm-rows').first().innerText()).replace(/\u00a0/g, ' ');
}

try {
  console.log(`\nFluentSSH UI E2E — ${BASE}\n`);

  await check('boots, hosts page renders demo lab hosts', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="host-card"]', { timeout: 15000 });
    const count = await page.locator('[data-testid="host-card"]').count();
    assert.ok(count >= 2, `expected >=2 host cards, got ${count}`);
    await screenshot('hosts');
  });

  await check('opens terminal session and receives shell banner', async () => {
    const card = page.locator('[data-testid="host-card"]').filter({ hasText: 'Mock SSH 终端' }).first();
    await card.locator('[data-testid="host-connect"]').click();
    await page.waitForSelector('[data-testid="terminal-host"] .xterm-rows', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const text = await terminalText();
    assert.match(text, /FluentSSH mock SSH server|demo@mock/, `terminal text: ${text.slice(0, 300)}`);
    await screenshot('terminal-light');
  });

  await check('terminal input round-trip + resize keeps session alive', async () => {
    await page.locator('[data-testid="terminal-host"]').first().click();
    await page.keyboard.type('echo fluent-e2e-ok', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    let text = await terminalText();
    assert.match(text, /fluent-e2e-ok/, 'echo output missing in terminal');
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.waitForTimeout(400);
    const dot = await page.locator('[data-testid="terminal-state-dot"]').first().getAttribute('data-state');
    assert.equal(dot, 'connected', `terminal state expected connected, got ${dot}`);
  });

  await check('command runner executes one-off exec', async () => {
    await page.locator('[data-testid="command-runner-toggle"]').click();
    await page.waitForSelector('[data-testid="command-runner-panel"]', { timeout: 5000 });
    await page.locator('[data-testid="command-runner-input"] textarea, [data-testid="command-runner-input"]').first().fill('echo runner-e2e-ok');
    await page.locator('[data-testid="send-command"]').click();
    await page.waitForTimeout(1500);
    const panel = await page.locator('[data-testid="command-runner-panel"]').innerText();
    assert.match(panel, /runner-e2e-ok/, 'command runner output missing');
    await screenshot('terminal-command-runner');
    await page.locator('[data-testid="command-runner-close"]').click();
  });

  await check('opens SFTP file manager and lists mock files', async () => {
    await page.locator('[data-testid="nav-hosts"]').click();
    await page.waitForTimeout(400);
    const card = page.locator('[data-testid="host-card"]').filter({ hasText: 'Mock SFTP 文件' }).first();
    await card.getByRole('button', { name: '文件', exact: true }).click();
    await page.waitForSelector('[data-testid="file-manager"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="file-row"]', { timeout: 20000 });
    const listing = await page.locator('[data-testid="file-table"]').innerText();
    assert.match(listing, /README\.md/, `README.md missing from listing: ${listing.slice(0, 500)}`);
    assert.match(listing, /logs/, 'logs directory missing from listing');
    await screenshot('files-light');
  });

  const folderName = `e2e-folder-${Date.now()}`;
  const uploadName = `e2e-upload-${Date.now()}.txt`;

  await check('creates a remote folder via toolbar', async () => {
    await page.locator('[data-testid="new-folder-button"]').click();
    await page.waitForSelector('[data-testid="new-folder-input"]', { timeout: 5000 });
    await page.locator('[data-testid="new-folder-input"] input, [data-testid="new-folder-input"]').first().fill(folderName);
    await page.locator('[data-testid="new-folder-submit"]').click();
    await page.waitForTimeout(1200);
    const listing = await page.locator('[data-testid="file-table"]').innerText();
    assert.match(listing, new RegExp(folderName), 'new folder not visible');
  });

  await check('uploads a local file with progress and queue', async () => {
    const uploadFile = path.join(OUT, uploadName);
    fs.writeFileSync(uploadFile, 'fluent-ssh upload e2e\n'.repeat(20));
    await page.locator('[data-testid="upload-input"]').setInputFiles(uploadFile);
    await page.waitForTimeout(2000);
    const listing = await page.locator('[data-testid="file-table"]').innerText();
    assert.match(listing, new RegExp(uploadName.replace('.', '\\.')), 'uploaded file missing from listing');
    // Uploads auto-open the drawer; only toggle if it is not visible yet.
    const drawer = page.locator('[data-testid="transfer-drawer"]');
    if (!(await drawer.isVisible().catch(() => false))) {
      await page.locator('[data-testid="transfer-button"]').click();
    }
    await drawer.waitFor({ timeout: 10000 });
    const drawerText = await drawer.innerText();
    assert.match(drawerText, new RegExp(uploadName.replace('.', '\\.')), 'transfer queue missing upload');
    await screenshot('files-transfer');
    await page.locator('[data-testid="transfer-close"]').click();
  });

  await check('opens text editor, edits and saves README.md', async () => {
    const row = page.locator('[data-testid="file-row"]').filter({ hasText: 'README.md' }).first();
    await row.dblclick();
    await page.waitForSelector('[data-testid="editor-dialog"]', { timeout: 10000 });
    await page.waitForTimeout(700);
    const textarea = page.locator('[data-testid="editor-textarea"]');
    await textarea.fill(`# Mock SFTP (edited by FluentSSH E2E ${Date.now()})\n`);
    await page.locator('[data-testid="editor-save"]').click();
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText();
    assert.match(bodyText, /文件已保存/, 'save success toast missing');
    await page.locator('[data-testid="editor-close"]').click();
    await page.waitForTimeout(400);
    const dialogCount = await page.locator('[data-testid="editor-dialog"]').count();
    assert.equal(dialogCount, 0, 'editor dialog did not close');
  });

  await check('host-key trust dialog appears for untrusted host and reconnects', async () => {
    const known = await api('/known-hosts');
    const entry = known.knownHosts.find(
      (item) => item.hostname === '127.0.0.1' && item.port === lab.ssh.port
    );
    assert.ok(entry, 'expected trusted known-host entry for mock ssh');
    const response = await requestContext.delete(`${BASE}/api/known-hosts/${entry.id}`);
    assert.equal(response.status(), 204, 'failed to remove known host');
    await page.locator('[data-testid="nav-hosts"]').click();
    await page.waitForTimeout(400);
    const card = page.locator('[data-testid="host-card"]').filter({ hasText: 'Mock SSH 终端' }).first();
    await card.locator('[data-testid="host-connect"]').click();
    await page.waitForTimeout(1200);
    const dialog = page.locator('[role="dialog"]').filter({ hasText: '验证主机密钥' }).first();
    await dialog.waitFor({ timeout: 10000 });
    await screenshot('hostkey-trust');
    await dialog.getByRole('button', { name: '信任并继续' }).click();
    await page.waitForTimeout(2500);
    const text = await terminalText();
    assert.match(text, /FluentSSH mock SSH server|demo@mock/, 'terminal did not connect after trusting host key');
  });

  await check('tunnels page starts local forwarding and traffic flows', async () => {
    await page.locator('[data-testid="nav-tunnels"]').click();
    const row = page.locator('[data-testid="tunnel-row"]').filter({ hasText: 'E2E HTTP 转发' }).first();
    await row.waitFor({ timeout: 10000 });
    await row.locator('[data-testid="tunnel-start"]').click();
    await page.waitForTimeout(1800);
    const activeRow = page.locator('[data-testid="tunnel-row"]').filter({ hasText: 'E2E HTTP 转发' }).first();
    const rowText = await activeRow.innerText();
    assert.match(rowText, /运行中|active/, `tunnel not active: ${rowText}`);
    const response = await fetch('http://127.0.0.1:15432/e2e');
    assert.equal(response.status, 200, 'HTTP through tunnel failed');
    const payload = await response.json();
    assert.equal(payload.service, 'fluent-ssh-tunnel-target');
    await screenshot('tunnels-active');
    await activeRow.locator('[data-testid="tunnel-stop"]').click();
    await page.waitForTimeout(700);
  });

  await check('dark theme terminal renders', async () => {
    await page.locator('[data-testid="nav-workspace"]').click();
    await page.waitForTimeout(500);
    await page.locator('button[aria-label="切换主题"]').click();
    await page.waitForTimeout(600);
    await screenshot('terminal-dark');
    await page.locator('button[aria-label="切换主题"]').click();
    await page.waitForTimeout(500);
  });

  await check('session recording appears in logs page', async () => {
    await page.locator('[data-testid="nav-logs"]').click();
    await page.waitForTimeout(700);
    await page.getByRole('tab', { name: /会话记录/ }).click();
    await page.waitForTimeout(700);
    const body = await page.locator('body').innerText();
    assert.match(body, /Mock SSH 终端|mock|终端/, 'session recording row missing');
    await screenshot('session-logs');
  });

  await check('no uncaught console/page errors', async () => {
    const relevant = consoleErrors.filter(
      (message) => !/favicon|Failed to load resource/.test(message)
    );
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(relevant, [], `console errors: ${relevant.join(' | ')}`);
  });

  console.log(`\nSummary: ${results.filter((item) => item.ok).length}/${results.length} steps passed.`);
  if (results.some((item) => !item.ok)) process.exitCode = 1;
} catch (error) {
  console.error('\nUI E2E failed:', error);
  await screenshot('failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
