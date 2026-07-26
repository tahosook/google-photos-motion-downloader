#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  extract-motion-photo-videos.sh [TARGET_DIR]

TARGET_DIR を再帰的に検索し、Motion Photo の JPG/JPEG から MP4 を抽出します。
MP4 は元の JPG/JPEG と同じフォルダに保存し、処理済みの JPG/JPEG は
TARGET_DIR/jpg/ に移動します。同名の MP4 や JPG/JPEG はスキップします。
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$#" -gt 1 ]]; then
  usage >&2
  exit 2
fi

target_dir="${1:-.}"

if [[ ! -d "$target_dir" ]]; then
  printf '対象フォルダが見つかりません: %s\n' "$target_dir" >&2
  exit 1
fi

if ! command -v exiftool >/dev/null 2>&1; then
  printf 'exiftool が見つかりません。\n' >&2
  exit 1
fi

archive_dir="$target_dir/jpg"
mkdir -p "$archive_dir"

extracted=0
skipped_not_motion=0
skipped_existing=0
skipped_move=0
moved=0
failed=0

move_to_archive() {
  local image="$1"
  local archive_path="$archive_dir/${image##*/}"

  if [[ "$image" == "$archive_path" ]]; then
    return 0
  fi

  if [[ -e "$archive_path" ]]; then
    skipped_move=$((skipped_move + 1))
    printf '移動スキップ（既存）: %s\n' "$archive_path"
    return 0
  fi

  if mv "$image" "$archive_path"; then
    moved=$((moved + 1))
    printf '移動: %s\n' "$archive_path"
  else
    failed=$((failed + 1))
    printf '移動失敗: %s\n' "$image" >&2
    return 1
  fi
}

while IFS= read -r -d '' image; do
  motion_photo=$(exiftool -q -q -s3 -MotionPhoto "$image" || true)
  if [[ "$motion_photo" != "1" ]]; then
    skipped_not_motion=$((skipped_not_motion + 1))
    continue
  fi

  output="${image%.*}.mp4"
  if [[ -e "$output" ]]; then
    skipped_existing=$((skipped_existing + 1))
    printf 'スキップ（既存）: %s\n' "$output"
    if ! move_to_archive "$image"; then
      :
    fi
    continue
  fi

  temporary=$(mktemp "${output}.tmp.XXXXXX")
  if exiftool -q -q -b -MotionPhotoVideo "$image" > "$temporary" && [[ -s "$temporary" ]]; then
    mv "$temporary" "$output"
    extracted=$((extracted + 1))
    printf '抽出: %s\n' "$output"
    if ! move_to_archive "$image"; then
      :
    fi
  else
    rm -f "$temporary"
    failed=$((failed + 1))
    printf '失敗: %s\n' "$image" >&2
  fi
done < <(
  find "$target_dir" -path "$archive_dir" -prune -o \
    -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) -print0
)

printf '完了: 抽出%d件、既存スキップ%d件、移動%d件、移動先既存スキップ%d件、対象外%d件、失敗%d件\n' \
  "$extracted" "$skipped_existing" "$moved" "$skipped_move" "$skipped_not_motion" "$failed"

if (( failed > 0 )); then
  exit 1
fi
