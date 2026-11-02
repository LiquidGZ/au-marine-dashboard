#!/usr/bin/env python3
"""
roll_workbook.py — open a new time-stamped edition of the master workbook.

The site's "Database as of" stamp is the live workbook's filename date, so a new edition is how the
database advances a version. This script makes that edition: it copies the newest
data/source/ADC_Master_<YYYYMMDD>.xlsx to today's name, stamps the copy's Meta sheet and writes a
Changelog row saying what the month's review queued against it. It does not move the old file —
archive_old_versions.py does that on the next build, which keeps one writer per job.

It never edits data. The new edition starts as an exact copy of the old one; the review queue says
what to change in it, and a person (or a Claude session working that queue) makes those edits.

    python scripts/roll_workbook.py --review review/2026-10.json
    python scripts/roll_workbook.py --date 2026-11-02 --force
    python scripts/roll_workbook.py --dry-run

Exit code is always 0 — a month with nothing to roll is a normal outcome, not a build failure.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import shutil
import sys

try:
    from openpyxl import load_workbook
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is required:  pip install -r scripts/requirements.txt")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "source")
TS_RE = re.compile(r"(\d{8})(?:_(\d{4}))?")
# Every list/dict in the review JSON is a bucket of queued items; scalars (headline counts, the
# window dates, the label) are context, not work. Counting by shape rather than by a fixed key list
# keeps this script working across repositories whose reviews emit different sections.
NOT_QUEUE = {"window"}


def key(path):
    m = TS_RE.search(os.path.basename(path))
    return (m.group(1), m.group(2) or "0000") if m else ("0", "0")


def live_workbook():
    files = [f for f in glob.glob(os.path.join(SRC, "*_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*.xlsx"))
             if not os.path.basename(f).startswith("~$")]
    if not files:
        sys.exit(f"No time-stamped *_<YYYYMMDD>.xlsx workbook found in {SRC}")
    return sorted(files, key=key)[-1]


def edition_name(live, date_iso):
    """Keep whatever prefix this repository uses — ADC_Master_, MARINE_Master_, anything."""
    base = os.path.basename(live)
    prefix = base[: TS_RE.search(base).start()]
    return f"{prefix}{date_iso.replace('-', '')}.xlsx"


def queue_size(review_path):
    """How many items the month's review raised, and a one-line description of them."""
    if not review_path or not os.path.exists(review_path):
        return None, "no review file"
    with open(review_path, encoding="utf-8") as fh:
        r = json.load(fh)
    parts, total = [], 0
    for k, v in r.items():
        if k in NOT_QUEUE or not isinstance(v, (list, dict)):
            continue
        n = len(v)
        total += n
        if n:
            parts.append(f"{n} {k.replace('_', ' ')}")
    return total, ", ".join(parts) or "nothing flagged"


def stamp_copy(path, date_iso, note):
    """Write the new edition's own date into Meta and append a Changelog row."""
    wb = load_workbook(path)

    ws = wb["Meta"]
    header = [c.value for c in ws[1]]
    kcol, vcol = header.index("key") + 1, header.index("value") + 1
    for row in range(2, ws.max_row + 1):
        if ws.cell(row=row, column=kcol).value == "data_as_of":
            ws.cell(row=row, column=vcol).value = date_iso
            break
    else:
        new_row = ws.max_row + 1
        ws.cell(row=new_row, column=kcol).value = "data_as_of"
        ws.cell(row=new_row, column=vcol).value = date_iso

    wb["Changelog"].append([os.path.basename(path), date_iso, "github-actions (monthly roll)", note])
    wb.save(path)


def emit(**kv):
    """Hand the workflow the outcome, so a skipped roll reads differently from a completed one."""
    out = os.environ.get("GITHUB_OUTPUT")
    if not out:
        return
    with open(out, "a", encoding="utf-8") as fh:
        for k, v in kv.items():
            fh.write(f"{k}={v}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", help="review/<YYYY-MM>.json; the roll is skipped when it queued nothing")
    ap.add_argument("--date", help="edition date (YYYY-MM-DD); default today UTC")
    ap.add_argument("--force", action="store_true", help="roll even when the review queued nothing")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    date_iso = a.date or dt.datetime.now(dt.timezone.utc).date().isoformat()
    try:
        dt.date.fromisoformat(date_iso)
    except ValueError:
        sys.exit(f"--date must be YYYY-MM-DD, got {date_iso!r}")

    live = live_workbook()
    new_name = edition_name(live, date_iso)
    new_path = os.path.join(SRC, new_name)

    if os.path.basename(live) == new_name or os.path.exists(new_path):
        print(f"{new_name} already exists — nothing to roll")
        emit(rolled="false", reason="edition already exists")
        return 0

    total, detail = queue_size(a.review)
    if total == 0 and not a.force:
        print(f"review queued nothing ({detail}) — keeping {os.path.basename(live)}; "
              f"the database stamp should not move when the data has not")
        emit(rolled="false", reason="review queued nothing")
        return 0

    note = (f"Monthly roll from {os.path.basename(live)}. Review queue: {detail}."
            if total is not None else
            f"Monthly roll from {os.path.basename(live)}.")

    print(f"rolling {os.path.basename(live)} -> {new_name}  ({detail})")
    if a.dry_run:
        return 0

    shutil.copy2(live, new_path)
    stamp_copy(new_path, date_iso, note)
    print(f"created data/source/{new_name}; {os.path.basename(live)} will move to data/archive/ "
          f"on the next build")
    emit(rolled="true", workbook=new_name, queue=(total if total is not None else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
