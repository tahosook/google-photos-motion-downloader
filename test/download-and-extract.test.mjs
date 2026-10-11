import test from 'node:test';
import assert from 'node:assert/strict';
import { runDownloadAndExtract } from '../scripts/download-and-extract.mjs';

test('download-and-extract shows help without error', async () => {
  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg; };
  try {
    await runDownloadAndExtract(['--help']);
    assert.match(output, /Usage:/);
    assert.match(output, /--skip-timestamps/);
  } finally {
    console.log = originalLog;
  }
});

test('download-and-extract rejects invalid dates', async () => {
  await assert.rejects(
    async () => {
      await runDownloadAndExtract(['--from', 'invalid-date']);
    },
    /Invalid date/
  );
});
