# Google Photos Motion Downloader

指定した日付範囲のGoogleフォトから、モーション写真だけを動画としてダウンロードします。

## Setup

```bash
npm install
npx playwright install chromium
```

## First Run

初回は表示ブラウザを起動してGoogleにログインします。

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08 --headed
```

ログイン状態は `.auth/google-photos/` に保存されます。このディレクトリはGit管理対象外です。

## Normal Run

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08
```

通常の Chrome のログイン済みセッションを使う場合は、Chrome を専用プロファイルとリモートデバッグポート付きで起動します。既存の通常プロファイルを直接指定する方法は、Chrome のプロファイルロックと DevTools 制限により利用しません。

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.auth/google-photos-cdp"
```

表示された Chrome で Google フォトにログインした後、別のターミナルで実行します。

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08 --cdp-url http://127.0.0.1:9222
```

動画は既定で次の構成に保存されます。

```text
downloads/
  2026-03-07/
  2026-03-08/
```

保存先を変更する場合:

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08 --output /path/to/output
```

同じ写真は `.motion-manifest.json` に記録され、再実行時にスキップされます。強制的に再取得する場合は `--force` を指定します。

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08 --force
```

## Options

```text
--from YYYY-MM-DD  対象開始日。終了日を含む
--to YYYY-MM-DD    対象終了日。開始日を含む
--output PATH      保存先。既定は ./downloads
--auth-dir PATH    専用ブラウザプロファイル。既定は .auth/google-photos
--cdp-url URL      起動済み Chrome に接続（例: http://127.0.0.1:9222）
--headed           ブラウザを表示して実行
--force            マニフェスト記録済みの写真も再取得
--help             ヘルプを表示
```

## Test

```bash
npm test
```

このスクリプトはGoogleフォト内の写真を削除、アーカイブ、編集しません。ログイン状態が期限切れになった場合は、`--headed` を付けて再ログインしてください。
