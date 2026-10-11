#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCliArgs, run as runDownload } from './download-motion-photos.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  return `Usage:
  npm run motion:all -- --from YYYY-MM-DD --to YYYY-MM-DD [options]

GoogleフォトからMotion Photoをダウンロードした後、続けてMP4動画の抽出とタイムスタンプ設定を一括実行します。

Options:
  --from YYYY-MM-DD  Inclusive start date (required)
  --to YYYY-MM-DD    Inclusive end date (required)
  --output PATH      Output directory (default: ./downloads)
  --auth-dir PATH    Dedicated browser profile directory (default: .auth/google-photos)
  --cdp-url URL      Connect to an already running Chrome (for example http://127.0.0.1:9222)
  --headed           Show the browser window
  --force            Re-download photos recorded in the manifest
  --skip-timestamps  Skip fixing file timestamps to shoot dates
  --help             Show this help
`;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command '${command} ${args.join(' ')}' exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

export async function runDownloadAndExtract(argv) {
  const skipTimestamps = argv.includes('--skip-timestamps');
  const filteredArgv = argv.filter((arg) => arg !== '--skip-timestamps');

  const options = parseCliArgs(filteredArgv);
  if (options.help) {
    console.log(usage());
    return;
  }

  options.manifestFile = path.join(options.output, '.motion-manifest.json');

  console.log('=== Step 1/3: Googleフォトからダウンロード ===');
  await runDownload(options);

  const extractScript = path.join(__dirname, 'extract-motion-photo-videos.sh');
  if (fsSync.existsSync(extractScript)) {
    console.log('\n=== Step 2/3: Motion Photo から MP4 動画を抽出 ===');
    try {
      await runCommand('bash', [extractScript, options.output]);
    } catch (error) {
      console.warn(`動画抽出で警告が発生しました: ${error.message}`);
    }
  }

  const timestampScript = path.join(__dirname, 'set-file-timestamps.py');
  if (!skipTimestamps && fsSync.existsSync(timestampScript)) {
    console.log('\n=== Step 3/3: 撮影日時に基づくタイムスタンプ設定 ===');
    try {
      await runCommand('python3', [timestampScript, options.output]);
    } catch (error) {
      console.warn(`タイムスタンプ設定で警告が発生しました: ${error.message}`);
    }
  }

  console.log('\nすべての処理が完了しました。');
}

async function main() {
  try {
    await runDownloadAndExtract(process.argv.slice(2));
  } catch (error) {
    console.error(`エラー: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
