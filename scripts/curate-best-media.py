#!/usr/bin/env python3
"""
Curate best quality media from a folder containing photos and videos.

Rules:
1. When both still and motion video exist for the same shot, prioritize the video.
2. For iPhone HEIC files, prioritize genuine HEIF/HEVC over re-encoded JPEGs.
3. Eliminate duplicate files using SHA-256 hash.
4. Preserve file timestamps.

Usage:
  python3 scripts/curate-best-media.py [SOURCE_DIR] [OUTPUT_DIR]
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.heic', '.png', '.webp', '.gif', '.bmp', '.tiff', '.dng'}
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.m4v'}


def get_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def is_genuine_heif(path: Path) -> bool:
    try:
        res = subprocess.run(['file', '-b', str(path)], capture_output=True, text=True, timeout=5).stdout
        return 'ISO Media' in res or 'HEIF' in res or 'heic' in res.lower()
    except Exception:
        return True


def curate_media(source_dir: Path, output_dir: Path) -> None:
    if not source_dir.is_dir():
        print(f'ソースディレクトリが見つかりません: {source_dir}', file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    all_files = []
    for fp in source_dir.rglob('*'):
        if not fp.is_file() or fp.name.startswith('.'):
            continue
        # Skip output dir if inside source dir
        try:
            if fp.resolve().is_relative_to(output_dir.resolve()):
                continue
        except AttributeError:
            if str(fp.resolve()).startswith(str(output_dir.resolve())):
                continue

        ext = fp.suffix.lower()
        if ext in IMAGE_EXTENSIONS or ext in VIDEO_EXTENSIONS or ext in ('.aae',):
            all_files.append(fp)

    print(f'対象ファイルスキャン: {len(all_files)} 件')

    # Step 1: Detect motion photo pairs (e.g. PXL_xxx.MP.jpg vs PXL_xxx.MP.mp4)
    # Map stem -> list of files
    stem_map = defaultdict(list)
    for fp in all_files:
        stem_map[fp.stem].append(fp)

    # If both .mp4 and .jpg exist for same stem (Motion Photo), drop .jpg
    files_after_motion_filter = []
    dropped_stills = set()
    for fp in all_files:
        ext = fp.suffix.lower()
        if ext in ('.jpg', '.jpeg'):
            has_video = any(other.suffix.lower() in VIDEO_EXTENSIONS for other in stem_map[fp.stem])
            if has_video:
                dropped_stills.add(fp)
                continue
        files_after_motion_filter.append(fp)

    print(f'Motion Photo判定: 動画を優先し、静止画 {len(dropped_stills)} 件を除外')

    # Step 2: For same-named files across different folders, pick highest quality
    name_map = defaultdict(list)
    for fp in files_after_motion_filter:
        name_map[fp.name].append(fp)

    selected_files = []
    for name, candidates in name_map.items():
        if len(candidates) == 1:
            selected_files.append(candidates[0])
            continue

        ext = candidates[0].suffix.lower()
        if ext == '.heic':
            # Prefer genuine HEIF over fake JPEG
            genuine = [c for c in candidates if is_genuine_heif(c)]
            if genuine:
                selected_files.append(genuine[0])
                continue

        # Default fallback: pick candidate with largest file size or first one
        best = max(candidates, key=lambda c: c.stat().st_size)
        selected_files.append(best)

    # Step 3: Deduplicate by SHA-256 hash
    hash_seen = set()
    final_files = []
    for fp in selected_files:
        h = get_sha256(fp)
        if h in hash_seen:
            continue
        hash_seen.add(h)
        final_files.append(fp)

    print(f'重複排除後: {len(final_files)} 件を {output_dir} に配置')

    copied_count = 0
    for fp in sorted(final_files, key=lambda f: f.name):
        dest = output_dir / fp.name
        if not dest.exists():
            shutil.copy2(fp, dest)
            copied_count += 1
            print(f'  [配置] {fp.name}')
        else:
            print(f'  [スキップ（既存）] {fp.name}')

    print(f'\n完了: {copied_count} 件のファイルを配置しました。（保存先: {output_dir}）')


def main():
    parser = argparse.ArgumentParser(description='写真・動画から最高品質のベスト版を抽出')
    parser.add_argument('source_dir', nargs='?', default='.', help='検索元ディレクトリ')
    parser.add_argument('output_dir', nargs='?', default=None, help='出力先ディレクトリ（デフォルト: source_dir/champion）')
    args = parser.parse_args()

    source = Path(args.source_dir).resolve()
    output = Path(args.output_dir).resolve() if args.output_dir else source / 'champion'

    curate_media(source, output)


if __name__ == '__main__':
    main()
