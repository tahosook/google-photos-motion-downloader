#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_OUTPUT_DIR = 'downloads';
const DEFAULT_AUTH_DIR = process.env.GOOGLE_PHOTOS_AUTH_DIR || '.auth/google-photos';
const DEFAULT_AUTH_MARKER = '.auth/google-photos/.authenticated';
const PHOTO_HOME = 'https://photos.google.com/';
const MAX_SCROLLS = 180;
const DISCOVERY_TIMEOUT_MS = 3 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function usage() {
  return `Usage:
  npm run motion -- --from YYYY-MM-DD --to YYYY-MM-DD [options]

Options:
  --from YYYY-MM-DD  Inclusive start date (required)
  --to YYYY-MM-DD    Inclusive end date (required)
  --output PATH      Output directory (default: ./downloads)
  --auth-dir PATH    Dedicated browser profile directory (default: .auth/google-photos)
  --cdp-url URL      Connect to an already running Chrome (for example http://127.0.0.1:9222)
  --headed            Show the browser window
  --force             Re-download photos recorded in the manifest
  --help              Show this help
`;
}

export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value ?? '(missing)'}. Use YYYY-MM-DD.`);
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date: ${value}.`);
  }
  return value;
}

export function parseDateFromLabel(label) {
  const match = String(label).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function isDateInRange(date, from, to) {
  return Boolean(date && date >= from && date <= to);
}

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'auth-dir': { type: 'string', default: DEFAULT_AUTH_DIR },
      'cdp-url': { type: 'string' },
      headed: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) return { help: true };
  const from = parseDate(values.from);
  const to = parseDate(values.to);
  if (from > to) throw new Error('--from must be on or before --to.');
  if (!values.output?.trim()) throw new Error('--output cannot be empty.');

  return {
    from,
    to,
    output: path.resolve(values.output),
    authDir: path.resolve(values['auth-dir']),
    cdpUrl: values['cdp-url']?.trim() || null,
    headed: values.headed,
    force: values.force,
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function waitForSignedIn(page, headed) {
  const isSignedIn = async () => {
    if (page.url().includes('accounts.google.com')) return false;
    return (await page.locator('[aria-label*="Google アカウント"], [aria-label*="Google Account"]').count()) > 0;
  };

  if (await isSignedIn()) return;
  if (!headed) {
    throw new Error('Googleログインが必要です。初回は --headed を付けて実行してください。');
  }

  console.log('ブラウザでGoogleフォトにログインしてください。ログイン完了を待機しています...');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isSignedIn()) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('ログインを確認できませんでした。');
}

async function collectPhotoLinks(page, from, to, options = {}) {
  const links = new Map();
  let stagnant = 0;
  let lastCount = 0;
  let oldestVisible = null;

  const deadline = Date.now() + (options.discoveryTimeoutMs || DISCOVERY_TIMEOUT_MS);
  for (let scroll = 0; scroll < MAX_SCROLLS; scroll += 1) {
    const visible = await page.locator('a[href*="/photo/"]').evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      label: anchor.getAttribute('aria-label') || anchor.textContent || '',
    })));

    for (const item of visible) {
      const date = parseDateFromLabel(item.label);
      if (!date) continue;
      oldestVisible = oldestVisible && oldestVisible < date ? oldestVisible : date;
      if (isDateInRange(date, from, to)) links.set(item.href, { href: item.href, date, label: item.label.trim() });
    }

    if (links.size === lastCount) stagnant += 1;
    else stagnant = 0;
    lastCount = links.size;

    if (oldestVisible && oldestVisible < from && stagnant >= 4) break;

    const beforeHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    await page.waitForTimeout(700);
    const atBottom = await page.evaluate(() => window.innerHeight + window.scrollY >= document.body.scrollHeight - 300);
    const afterHeight = await page.evaluate(() => document.body.scrollHeight);
    if (atBottom && afterHeight === beforeHeight && stagnant >= 4) break;
    if ((scroll + 1) % 20 === 0) console.log(`写真一覧を確認中: ${scroll + 1}/${MAX_SCROLLS}スクロール、対象${links.size}件`);
    if (Date.now() >= deadline) throw new Error(`写真一覧の取得がタイムアウトしました（${Math.round((options.discoveryTimeoutMs || DISCOVERY_TIMEOUT_MS) / 1000)}秒）。`);
  }

  return [...links.values()].sort((a, b) => a.date.localeCompare(b.date) || a.href.localeCompare(b.href));
}

async function getPhotoAlt(page) {
  const locator = page.locator('img[alt^="写真 - "], img[alt^="Photo - "]');
  if (!(await locator.count())) return null;
  return locator.first().getAttribute('alt').catch(() => null);
}

async function downloadMotionPhoto(page, photo, options, manifest) {
  const entry = manifest[photo.href];
  if (entry && !options.force && fsSync.existsSync(entry.file)) {
    return { status: 'skipped_existing', file: entry.file };
  }

  await page.goto(photo.href, { waitUntil: 'domcontentloaded' });
  const moreBtn = page.locator('button[aria-label*="その他のオプション"]:visible, button[aria-label*="More options"]:visible').first();
  await moreBtn.waitFor({ timeout: 15000 });

  const motionButton = page.locator('button[aria-label*="モーション フォト"]:visible, button[aria-label*="Motion photo"]:visible');
  if (!(await motionButton.count())) return { status: 'skipped_not_motion' };

  await moreBtn.click();
  const videoItem = page.locator('[role="menuitem"]:visible').filter({ hasText: /動画をダウンロード|Download video/ });
  if (!(await videoItem.count())) {
    await page.keyboard.press('Escape').catch(() => {});
    return { status: 'skipped_no_video_menu' };
  }

  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS });
  await videoItem.first().click();
  const download = await downloadPromise;
  const failure = await download.failure();
  if (failure) throw new Error(`Download failed for ${photo.href}: ${failure}`);

  const alt = await getPhotoAlt(page);
  const date = parseDateFromLabel(alt) || photo.date;
  const dateDir = path.join(options.output, date);
  await fs.mkdir(dateDir, { recursive: true });
  const file = path.join(dateDir, download.suggestedFilename());
  await download.saveAs(file);
  manifest[photo.href] = { date, file, downloadedAt: new Date().toISOString() };
  await writeJson(options.manifestFile, manifest);
  return { status: 'downloaded', file };
}

export async function run(options) {
  const { chromium } = await import('playwright');
  await fs.mkdir(options.output, { recursive: true });
  const manifest = await readJson(options.manifestFile, {});
  const authMarker = path.resolve(options.authMarkerFile || (options.cdpUrl
    ? DEFAULT_AUTH_MARKER
    : path.join(options.authDir, '.authenticated')));
  const headed = options.headed || !fsSync.existsSync(authMarker);
  let browser;
  let context;
  let ownsBrowser = false;

  if (options.cdpUrl) {
    browser = await chromium.connectOverCDP(options.cdpUrl);
    context = browser.contexts()[0];
    if (!context) throw new Error(`CDP接続先にブラウザコンテキストがありません: ${options.cdpUrl}`);
  } else {
    browser = await chromium.launchPersistentContext(options.authDir, {
      headless: !headed,
      acceptDownloads: true,
      ...(fsSync.existsSync(CHROME_EXECUTABLE) ? { executablePath: CHROME_EXECUTABLE } : {}),
    });
    context = browser;
    ownsBrowser = true;
  }

  try {
    const page = context.pages().find((candidate) => candidate.url().startsWith('https://photos.google.com'))
      || context.pages()[0]
      || await context.newPage();
    if (page.url() !== PHOTO_HOME) {
      await page.goto(PHOTO_HOME, { waitUntil: 'domcontentloaded' });
    }
    await waitForSignedIn(page, headed);
    await fs.mkdir(path.dirname(authMarker), { recursive: true });
    await fs.writeFile(authMarker, `${new Date().toISOString()}\n`, 'utf8');
    const photos = await collectPhotoLinks(page, options.from, options.to, options);
    if (!photos.length) throw new Error(`対象期間の写真が見つかりませんでした: ${options.from} - ${options.to}`);

    console.log(`対象写真: ${photos.length}件`);
    const counts = { downloaded: 0, skipped_existing: 0, skipped_not_motion: 0, skipped_no_video_menu: 0, failed: 0 };
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      try {
        const result = await downloadMotionPhoto(page, photo, options, manifest);
        counts[result.status] = (counts[result.status] || 0) + 1;
        console.log(`[${index + 1}/${photos.length}] ${photo.date}: ${result.status}${result.file ? ` -> ${result.file}` : ''}`);
      } catch (error) {
        counts.failed += 1;
        console.error(`[${index + 1}/${photos.length}] ${photo.date}: failed: ${error.message}`);
      }
    }
    console.log(`完了: ${JSON.stringify(counts)}`);
    if (counts.failed > 0) process.exitCode = 1;
  } finally {
    if (ownsBrowser) {
      await context.close();
    } else if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    options.manifestFile = path.join(options.output, '.motion-manifest.json');
    await run(options);
  } catch (error) {
    console.error(`エラー: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
