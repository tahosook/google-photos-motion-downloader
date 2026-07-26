#!/usr/bin/env bash

set -euo pipefail

target_dir="${1:-.}"

if [[ ! -d "$target_dir" ]]; then
  printf '対象フォルダが見つかりません: %s\n' "$target_dir" >&2
  exit 1
fi

if ! command -v SetFile >/dev/null 2>&1; then
  printf 'SetFile が見つかりません。Xcode Command Line Tools を確認してください。\n' >&2
  exit 1
fi

processed=0
skipped=0

while IFS= read -r -d '' file; do
  filename=${file##*/}

  if [[ "$filename" =~ ^PXL_([0-9]{8})_([0-9]{6}) ]]; then
    ymd=${BASH_REMATCH[1]}
    hms=${BASH_REMATCH[2]}

    # touch: 更新日時・アクセス日時
    touch -t "${ymd}${hms:0:4}.${hms:4:2}" "$file"

    # SetFile: macOS の作成日時
    SetFile -d \
      "${ymd:4:2}/${ymd:6:2}/${ymd:0:4} ${hms:0:2}:${hms:2:2}:${hms:4:2}" \
      "$file"

    processed=$((processed + 1))
  else
    skipped=$((skipped + 1))
  fi
done < <(
  find "$target_dir" -type f \( \
    -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.mp4' \
  \) -print0
)

printf '日時設定完了: %d 個\n' "$processed"
if (( skipped > 0 )); then
  printf 'ファイル名の日時形式が合わずスキップ: %d 個\n' "$skipped"
fi
