#!/usr/bin/env python3
"""
ファイルのタイムスタンプを EXIF 情報に基づいて設定する。
JPEG: EXIF:DateTimeOriginal / EXIF:CreateDate / EXIF:ModifyDate
MP4:  QuickTime:CreateDate / QuickTime:ModifyDate
EXIF が取得できない場合はファイル名 (PXL_YYYYMMDD_HHMMSS...) から日時を抽出する。

Usage:
    python3 scripts/set-file-timestamps.py [target_directory]
"""

import argparse
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List

JST = timezone(timedelta(hours=9))


def get_exif_timestamp(filepath: str, tags: List[str], quicktime_utc: bool = False) -> Optional[str]:
    """exiftool で指定タグからタイムスタンプを取得する（ローカル時刻として返す）。"""
    base_args = ['exiftool', '-q', '-q', '-s3', '-d', '%Y%m%d%H%M.%S']
    if quicktime_utc:
        base_args.insert(1, '-api')
        base_args.insert(2, 'QuickTimeUTC=1')
    for tag in tags:
        try:
            result = subprocess.run(
                base_args + [f'-{tag}', filepath],
                capture_output=True, text=True, timeout=10,
            )
            ts = result.stdout.strip()
            if re.match(r'^\d{12}\.\d{2}$', ts):
                return ts
        except (subprocess.TimeoutExpired, OSError):
            continue
    return None


def get_filename_timestamp(filename: str) -> Optional[str]:
    """ファイル名 PXL_YYYYMMDD_HHMMSS... からタイムスタンプを抽出する。"""
    m = re.match(r'^PXL_(\d{8})_(\d{6})', filename)
    if m:
        ymd = m.group(1)
        hms = m.group(2)
        return f'{ymd}{hms[:4]}.{hms[4:6]}'
    # → YYYYMMDDHHMM.SS (12桁.2桁)
    return None


def set_file_timestamps(filepath: str, timestamp_str: str) -> bool:
    """
    ファイルのタイムスタンプを設定する。
    - touch (os.utime): 更新日時・アクセス日時
    - SetFile: macOS の作成日時
    """
    try:
        dt = datetime.strptime(timestamp_str, '%Y%m%d%H%M.%S')
        ts = dt.timestamp()

        # 更新日時・アクセス日時
        os.utime(filepath, (ts, ts))

        # macOS の作成日時 (SetFile)
        date_part = timestamp_str.split('.')[0]
        time_part = timestamp_str.split('.')[1]
        setfile_date = f'{date_part[4:6]}/{date_part[6:8]}/{date_part[0:4]} {date_part[8:10]}:{date_part[10:12]}:{time_part}'
        subprocess.run(
            ['SetFile', '-d', setfile_date, filepath],
            capture_output=True, text=True, timeout=10, check=True,
        )
        return True
    except (ValueError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


def main():
    parser = argparse.ArgumentParser(description='EXIF/ファイル名からタイムスタンプを設定')
    parser.add_argument('target_dir', nargs='?', default='.',
                        help='対象ディレクトリ（デフォルト: カレントディレクトリ）')
    args = parser.parse_args()

    target_dir = Path(args.target_dir)
    if not target_dir.is_dir():
        print(f'対象フォルダが見つかりません: {target_dir}', file=sys.stderr)
        sys.exit(1)

    # 必要なコマンドの確認
    for cmd in ['exiftool', 'SetFile']:
        if not subprocess.run(['which', cmd], capture_output=True).returncode == 0:
            print(f'{cmd} が見つかりません。', file=sys.stderr)
            sys.exit(1)

    processed = 0
    skipped = 0
    exif_used = 0
    filename_fallback = 0

    # 対象拡張子
    extensions = ('.jpg', '.jpeg', '.mp4')

    for filepath in sorted(target_dir.rglob('*')):
        if not filepath.is_file():
            continue
        if filepath.suffix.lower() not in extensions:
            continue

        filename = filepath.name
        timestamp = None

        if filepath.suffix.lower() in ('.jpg', '.jpeg'):
            timestamp = get_exif_timestamp(
                str(filepath),
                ['EXIF:DateTimeOriginal', 'EXIF:CreateDate', 'EXIF:ModifyDate'],
            )
        elif filepath.suffix.lower() == '.mp4':
            # QuickTime タグは UTC で保存されているので -api QuickTimeUTC=1 で JST に変換
            timestamp = get_exif_timestamp(
                str(filepath),
                ['QuickTime:CreateDate', 'QuickTime:ModifyDate'],
                quicktime_utc=True,
            )

        if timestamp:
            exif_used += 1
        else:
            timestamp = get_filename_timestamp(filename)
            if timestamp:
                filename_fallback += 1

        if timestamp:
            if set_file_timestamps(str(filepath), timestamp):
                processed += 1
            else:
                skipped += 1
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