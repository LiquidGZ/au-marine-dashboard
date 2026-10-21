#!/usr/bin/env python3
"""
monthly_review.py — write a review brief from last month's headlines. It reads data and writes Markdown; it never
edits the workbook. Run on the 1st of each month by .github/workflows/monthly-review.yml (opens a GitHub issue).

    python scripts/monthly_review.py [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out review.md]

Sections
  1. Projects named in the news (matched on distinctive project names by fetch_news.py)
  2. Operators named in the news
  3. Headlines by resource category (policy-relevant ones flagged)
  4. Project rows not re-verified for 180+ days that are still moving (not operating steady-state, not cancelled)
"""
import argparse
import datetime as dt
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
CATS = {"fossil": "Fossil energy / 化石能源", "renewable": "Renewable energy / 可再生能源", "mineral": "Minerals / 矿产资源",
        "agri": "Fisheries & aquaculture / 渔业与水产养殖", "other": "Other resources / 其他资源"}
POLICY_WORDS = ["nopsema", "nopta", "regulator", "legislation", "bill", "act ", "approval", "approved", "licence", "license", "epbc",
                "reservation", "auction", "tender", "levy", "royalty", "prrt", "quota", "ban", "moratorium", "法", "审批", "许可", "招标"]


def load(n, d):
    try:
        with open(os.path.join(DATA, n), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return d


def main():
    ap = argparse.ArgumentParser()
    today = dt.date.today()
    first_this = today.replace(day=1)
    first_last = (first_this - dt.timedelta(days=1)).replace(day=1)
    ap.add_argument("--since", default=first_last.isoformat())
    ap.add_argument("--until", default=first_this.isoformat())
    ap.add_argument("--out", default="review.md")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    news = load("news.json", {"items": []})["items"]
    projects = {p["project_id"]: p for p in load("projects.json", [])}
    items = [i for i in news if a.since <= (i.get("published") or "")[:10] < a.until]
    by_proj, by_op, by_cat = defaultdict(list), defaultdict(list), defaultdict(list)
    for i in items:
        for p in i.get("projects", []):
            by_proj[p].append(i)
        for o in i.get("operators", []):
            by_op[o].append(i)
        for c in i.get("categories", []) or ["untagged"]:
            by_cat[c].append(i)

    L = [f"# Monthly data review / 月度数据复核 — {a.since[:7]}", "",
         f"Headlines {a.since} to {a.until} (exclusive): **{len(items)}**. Tick each box once the workbook is updated or the item is judged not material.", ""]
    L += ["## 1. Projects named in the news / 新闻涉及的项目", ""]
    for pid, its in sorted(by_proj.items(), key=lambda x: -len(x[1])):
        p = projects.get(pid, {})
        L.append(f"- [ ] **{p.get('name', pid)}** ({pid}, {p.get('stage', '?')}, last verified {p.get('last_verified', '?')})")
        L += [f"  - {i['published'][:10]} [{i['title']}]({i['link']})" for i in its[:5]]
    if not by_proj:
        L.append("_None matched._")
    L += ["", "## 2. Operators named in the news / 新闻涉及的运营商", ""]
    for o, its in sorted(by_op.items(), key=lambda x: -len(x[1])):
        L.append(f"- [ ] **{o}** — {len(its)} headline(s)")
        L += [f"  - {i['published'][:10]} [{i['title']}]({i['link']})" for i in its[:4]]
    L += ["", "## 3. By resource category / 按资源类别", ""]
    for c in list(CATS) + ["untagged"]:
        its = by_cat.get(c, [])
        if not its:
            continue
        L.append(f"### {CATS.get(c, 'Untagged / 未归类')} ({len(its)})")
        for i in its[:25]:
            flag = " ⚑" if any(w in (i["title"] or "").lower() for w in POLICY_WORDS) else ""
            L.append(f"- [ ] {i['published'][:10]} [{i['title']}]({i['link']}){flag}")
        L.append("")
    L += ["⚑ = likely regulatory or policy item — check the Policy sheets.", "", "## 4. Rows due for re-verification / 待复核项目（180天以上未更新）", ""]
    cutoff = (today - dt.timedelta(days=180)).strftime("%Y-%m")
    stale = [p for p in projects.values() if (p.get("last_verified") or "0000") < cutoff and p.get("stage") not in ("Operational", "Cancelled", "Decommissioned")]
    L += [f"- [ ] {p['name']} ({p['project_id']}, {p['stage']}, last verified {p.get('last_verified')})" for p in stale] or ["_None._"]
    with open(a.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"since": a.since, "until": a.until, "headlines": len(items), "projects": {k: len(v) for k, v in by_proj.items()},
                       "operators": {k: len(v) for k, v in by_op.items()}, "stale": [p["project_id"] for p in stale]}, fh, ensure_ascii=False, indent=1)
    print(f"wrote {a.out}: {len(items)} headlines, {len(by_proj)} projects, {len(stale)} stale rows")


if __name__ == "__main__":
    main()
