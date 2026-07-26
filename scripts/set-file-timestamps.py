#!/usr/bin/env python3
"""
Set file timestamps from EXIF/QuickTime metadata.

JPEG: Composite:DateTimeOriginal > EXIF:DateTimeOriginal > Composite:CreateDate > EXIF:CreateDate > EXIF:ModifyDate
MP4:  QuickTime:CreateDate > QuickTime:ModifyDate (UTC → JST via QuickTimeUTC=1)
Fallback: PXL_YYYYMMDD_HHMMSS filename pattern

Usage: python3 scripts/set-file-timestamps.py [target_directory]
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

JST = timezone(timedelta(hours=9))
TIMESTAMP_FMT = '%Y%m%d%H%M.%S'
TIMESTAMP_RE = re.compile(r'^\d{12}\.\d{2}$')

JPG_TAGS = [
    'Composite:DateTimeOriginal',
    'EXIF:DateTimeOriginal',
    'EXIF:CreateDate',
    'EXIF:ModifyDate',
]

MP4_TAGS = [
    'QuickTime:CreateDate',
    'QuickTime:ModifyDate',
]

TARGET_EXTENSIONS = ('.jpg', '.jpeg', '.mp4')


def require_command(cmd: str) -> None:
    """Check a command is available; exit with error if not found."""
    if shutil.which(cmd) is None:
        print(f'{cmd} が見つかりません。', file=sys.stderr)
        sys.exit(1)


def get_exif_metadata(filepath: str, tags: List[str], *, quicktime_utc: bool = False) -> Dict[str, str]:
    """
    Run exiftool once per file and return a dict of tag → value.

    With ``-G`` the JSON keys include the group prefix, e.g.
    ``EXIF:DateTimeOriginal`` or ``QuickTime:CreateDate``.

    Only tags whose value matches the expected timestamp format are kept.
    """
    args = ['exiftool', '-q', '-q', '-json', '-G', '-d', TIMESTAMP_FMT]
    if quicktime_utc:
        args.extend(['-api', 'QuickTimeUTC=1'])
    for tag in tags:
        args.append(f'-{tag}')
    args.append(filepath)

    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            return {}
        raw = result.stdout.strip()
        if not raw:
            return {}
        data = json.loads(raw)
        if not data:
            return {}
        entry: dict = data[0]
        # Keep only values matching the expected format
        validated: Dict[str, str] = {}
        for key, value in entry.items():
            # -json -G と -d を同時に使うと値が float/int で返ることがある
            if isinstance(value, str):
                s = value
            elif isinstance(value, (int, float)):
                s = f'{value:.2f}'
            else:
                continue
            if TIMESTAMP_RE.match(s):
                validated[key] = s
        return validated
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError, IndexError):
        return {}


def pick_best_timestamp(metadata: Dict[str, str], priority_tags: List[str]) -> Optional[str]:
    """Return the first tag from *priority_tags* that exists in *metadata*."""
    for tag in priority_tags:
        if tag in metadata:
            return metadata[tag]
    return None


def parse_timestamp_jst(ts: str) -> datetime:
    """Parse ``YYYYMMDDHHMM.SS`` as JST and return an aware datetime."""
    return datetime.strptime(ts, TIMESTAMP_FMT).replace(tzinfo=JST)


def extract_filename_timestamp(filename: str) -> Optional[str]:
    """Extract ``YYYYMMDDHHMM.SS`` from ``PXL_YYYYMMDD_HHMMSS...``."""
    m = re.match(r'^PXL_(\d{8})_(\d{6})', filename)
    if m:
        return f'{m.group(1)}{m.group(2)[:4]}.{m.group(2)[4:6]}'
    return None


def set_file_timestamps(filepath: str, dt: datetime) -> bool:
    """
    Set modification/access time via ``os.utime`` and
    macOS creation date via ``SetFile``.
    """
    try:
        ts = dt.timestamp()
        os.utime(filepath, (ts, ts))

        setfile_val = dt.strftime('%m/%d/%Y %H:%M:%S')
        subprocess.run(
            ['SetFile', '-d', setfile_val, filepath],
            capture_output=True, text=True, timeout=10, check=True,
        )
        return True
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


def process_one(path: Path) -> Tuple[str, Optional[datetime]]:
    """
    Determine the best timestamp for *path*.

    Returns ``(source_label, aware_datetime_or_None)``.
    *source_label* is ``'exiftool'``, ``'filename'``, or ``''``.
    """
    suffix = path.suffix.lower()
    filename = path.name
    ts_str: Optional[str] = None

    if suffix in ('.jpg', '.jpeg'):
        meta = get_exif_metadata(str(path), JPG_TAGS)
        ts_str = pick_best_timestamp(meta, JPG_TAGS)
    elif suffix == '.mp4':
        meta = get_exif_metadata(str(path), MP4_TAGS, quicktime_utc=True)
        ts_str = pick_best_timestamp(meta, MP4_TAGS)

    if ts_str is not None:
        return ('exiftool', parse_timestamp_jst(ts_str))

    ts_str = extract_filename_timestamp(filename)
    if ts_str is not None:
        return ('filename', parse_timestamp_jst(ts_str))

    return ('', None)


def main() -> None:
    parser = argparse.ArgumentParser(
        description='EXIF/ファイル名からタイムスタンプを設定',
    )
    parser.add_argument('target_dir', nargs='?', default='.',
                        help='対象ディレクトリ（デフォルト: カレントディレクトリ）')
    args = parser.parse_args()

    target = Path(args.target_dir)
    if not target.is_dir():
        print(f'対象フォルダが見つかりません: {target}', file=sys.stderr)
        sys.exit(1)

    require_command('exiftool')
    require_command('SetFile')

    processed = 0
    skipped = 0
    exif_used = 0
    filename_fallback = 0

    for fp in sorted(target.rglob('*')):
        if not fp.is_file():
            continue
        if fp.suffix.lower() not in TARGET_EXTENSIONS:
            continue

        source, dt = process_one(fp)

        if dt is None:
            skipped += 1
            continue

        if source == 'exiftool':
            exif_used += 1
        else:
            filename_fallback += 1

        if set_file_timestamps(str(fp), dt):
            processed += 1
        else:
            skipped += 1

    print(f'日時設定完了: {processed} 個')
    print(f'  exiftool の日時を使用: {exif_used} 個')
    if filename_fallback > 0:
        print(f'  ファイル名の日時をフォールバックとして使用: {filename_fallback} 個')
    if skipped > 0:
        print(f'  日時を取得できず、または設定に失敗してスキップ: {skipped} 個')


if __name__ == '__main__':
    main()