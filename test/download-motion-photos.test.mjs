import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateInRange,
  parseCliArgs,
  parseDate,
  parseDateFromLabel,
} from '../scripts/download-motion-photos.mjs';

test('parses valid ISO dates and rejects invalid dates', () => {
  assert.equal(parseDate('2026-03-07'), '2026-03-07');
  assert.throws(() => parseDate('2026-02-30'), /Invalid date/);
  assert.throws(() => parseDate('03-07-2026'), /Invalid date/);
});

test('extracts Japanese and English photo labels', () => {
  assert.equal(parseDateFromLabel('写真 - 横向き - 2026/03/08 14:53:22'), '2026-03-08');
  assert.equal(parseDateFromLabel('Photo - landscape - 2026-03-07 09:10:11'), '2026-03-07');
  assert.equal(parseDateFromLabel('アルバム'), null);
});

test('date ranges are inclusive', () => {
  assert.equal(isDateInRange('2026-03-07', '2026-03-07', '2026-03-08'), true);
  assert.equal(isDateInRange('2026-03-08', '2026-03-07', '2026-03-08'), true);
  assert.equal(isDateInRange('2026-03-09', '2026-03-07', '2026-03-08'), false);
});

test('parses CLI options and defaults output directory', () => {
  const options = parseCliArgs(['--from', '2026-03-07', '--to', '2026-03-08']);
  assert.equal(options.from, '2026-03-07');
  assert.equal(options.to, '2026-03-08');
  assert.equal(options.output.endsWith('/downloads'), true);
  assert.equal(options.headed, false);
  assert.equal(options.force, false);
  assert.equal(options.cdpUrl, null);
});

test('parses a CDP URL and dedicated auth directory', () => {
  const options = parseCliArgs([
    '--from', '2026-03-07',
    '--to', '2026-03-08',
    '--cdp-url', 'http://127.0.0.1:9222',
    '--auth-dir', '.auth/custom',
  ]);
  assert.equal(options.cdpUrl, 'http://127.0.0.1:9222');
  assert.equal(options.authDir.endsWith('/.auth/custom'), true);
});

test('rejects reversed ranges and missing dates', () => {
  assert.throws(() => parseCliArgs(['--from', '2026-03-08', '--to', '2026-03-07']), /on or before/);
  assert.throws(() => parseCliArgs(['--from', '2026-03-07']), /Invalid date/);
});
