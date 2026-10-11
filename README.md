# Google Photos Motion Downloader

Googleフォトからダウンロードした写真（Motion Photo）から動画（MP4）を抽出・整理するツールです。

## Setup

```bash
npm install
# 必要に応じて（ブラウザ自動ダウンロードを使用する場合のみ）
npx playwright install chromium
```

## Extract MP4 from JPG (動画抽出)

Googleフォト等からダウンロードした Motion Photo（JPG/JPEG）に埋め込まれた動画を、`exiftool` で MP4 として抽出します。
MP4 は元の画像と同じフォルダに保存され、処理済みの元 JPG/JPEG は対象フォルダ直下の `jpg/` に移動されます。
同名の MP4 や移動先の JPG/JPEG が既にある場合はスキップされます。

```bash
npm run motion:extract -- /path/to/photos
```

対象フォルダを省略した場合は、カレントディレクトリを検索します。

```bash
npm run motion:extract
```

## Set File Timestamps (撮影日時の復元)

Googleフォトの一括ダウンロードやZIP解凍等により、ファイルのタイムスタンプが「ダウンロード日時」になってしまった場合に、EXIF / QuickTimeのメタデータから本来の撮影日時（JST）を取得して作成日・変更日（macOS対応）を一括復元します。
JPG、MP4、HEIC に対応しています。

```bash
npm run photo:timestamp -- /path/to/photos
```

## Curate Best Media (最高品質アルバムの作成)

複数のフォルダ（iPhone、Pixel、ドラレコ等）から最高品質の写真・動画だけを厳選し、重複のない `champion/` フォルダを自動生成します。

- **Motion Photo**: 同一撮影の静止画（JPG）を除外し、動画（MP4）を優先採用
- **iPhone写真**: 再エンコードされたJPEG（偽装HEIC）ではなく、オリジナルの生HEIC（HDR・広色域保持）を優先採用
- **重複排除**: SHA-256ハッシュによる完全同一ファイルの自動集約
- **タイムスタンプ維持**: 元の撮影日時を保持して配置

```bash
npm run photo:curate -- /path/to/source_dir
```

---

## Google フォトからのブラウザダウンロード (参考機能)

> [!NOTE]
> Google フォトのUI仕様変更やセッション状態により、ブラウザ経由の自動ダウンロードが安定しない場合があります。基本的にはGoogleフォトのWebやアプリから通常通り写真をダウンロードし、上記の `npm run motion:extract` で動画を抽出する運用が確実です。

### 初回認証 (First Run)

初回は表示ブラウザを起動してGoogleにログインします。

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08 --headed
```

ログイン状態は `.auth/google-photos/` に保存されます。

### 通常実行 (Normal Run)

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08
```

通常の Chrome のログイン済みセッションを使う場合:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.auth/google-photos-cdp"
```

```bash
npm run motion -- --from 2026-03-07 --to 2026-03-08 --cdp-url http://127.0.0.1:9222
```

### ダウンロードと動画抽出の一括実行

ダウンロード後に続けて動画抽出・日時設定まで実行する場合:

```bash
npm run motion:all -- --from 2026-03-07 --to 2026-03-08
```

### Tampermonkey (User Script)

普段使いの Chrome で Google フォトを開いて直接ダウンロードする場合のユーザースクリプトです。

1. Tampermonkey に `scripts/tampermonkey-motion-downloader.user.js` を登録します。
2. 通常の Chrome で Google フォト（https://photos.google.com/）を開くと、画面右上に操作パネルが表示されます。
3. 日付範囲を指定して「開始」をクリックすると、順次ダウンロードされます。

### Options

```text
--from YYYY-MM-DD  対象開始日。終了日を含む
--to YYYY-MM-DD    対象終了日。開始日を含む
--output PATH      保存先。既定は ./downloads
--auth-dir PATH    専用ブラウザプロファイル。既定は .auth/google-photos
--cdp-url URL      起動済み Chrome に接続（例: http://127.0.0.1:9222）
--headed           ブラウザを表示して実行
--force            マニフェスト記録済みの写真も再取得
--skip-timestamps  タイムスタンプ設定をスキップ（motion:all のみ）
--help             ヘルプを表示
```

## Test

```bash
npm test
```

このスクリプトはGoogleフォト内の写真を削除、アーカイブ、編集しません。
