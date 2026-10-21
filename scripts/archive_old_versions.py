#!/usr/bin/env python3
"""
archive_old_versions.py — keep exactly one workbook in data/source/ and move the rest to data/archive/.

The build always uses the newest AMR_Master_<YYYYMMDD[_HHMM]>.xlsx in data/source/. When you add a new
version through the GitHub website (Add file -> Upload files), the older one is simply left behind; this
script moves it into data/archive/ so the source folder stays unambiguous. It runs automatically in the
GitHub Actions workflow, and does nothing when there is only one workbook.

    python scripts/archive_old_versions.py          # move older versions
    python scripts/archive_old_versions.py --dry-run
"""
import glob
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "source")
ARC = os.path.join(ROOT, "data", "archive")
TS_RE = re.compile(r"(\d{8})(?:_(\d{4}))?")


def key(path):
    m = TS_RE.search(os.path.basename(path))
    return (m.group(1), m.group(2) or "0000") if m else ("0", "0")


def main():
    dry = "--dry-run" in sys.argv
    files = [f for f in glob.glob(os.path.join(SRC, "AMR_Master_*.xlsx"))
             if not os.path.basename(f).startswith("~$")]
    if len(files) <= 1:
        print(f"data/source has {len(files)} workbook — nothing to archive")
        return 0
    files.sort(key=key)
    newest, older = files[-1], files[:-1]
    os.makedirs(ARC, exist_ok=True)
    for f in older:
        dest = os.path.join(ARC, os.path.basename(f))
        if os.path.exists(dest):
            base, ext = os.path.splitext(os.path.basename(f))
            dest = os.path.join(ARC, f"{base}_dup{ext}")
        print(f"archiving {os.path.basename(f)} -> data/archive/{os.path.basename(dest)}")
        if not dry:
            shutil.move(f, dest)
    print(f"keeping {os.path.basename(newest)} as the live version")
    return 0


if __name__ == "__main__":
    sys.exit(main())
