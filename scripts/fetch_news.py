#!/usr/bin/env python3
"""
fetch_news.py — poll the RSS feeds listed in the workbook's NewsSources sheet (via site/data/news_sources.json)
and merge new headlines into site/data/news.json. Standard library only. Run daily by GitHub Actions.

    python scripts/build_data.py     # first, so news_sources.json / news_rules.json reflect the workbook
    python scripts/fetch_news.py

Behaviour
  * THE ARCHIVE ONLY GROWS. Nothing is deleted from news.json; each run appends what it has not seen.
    meta.news_days_to_keep controls how far back the SITE shows by default, not what is stored.
  * de-duplicates by link and by normalised title, across sources and across runs
  * optional filter_keywords per source (any keyword, case-insensitive, matched on title+summary)
  * tags each item with resource categories / sub-categories (NewsRules sheet), states, operators and projects
  * a headline that matches no rule falls back to its source's default_category
  * never fails the build: a feed that errors is logged and skipped; the existing archive is preserved
"""
import datetime as dt
import email.utils
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
NEWS_PATH = os.path.join(DATA, "news.json")
UA = "Mozilla/5.0 (compatible; au-marine-dashboard-news/1.0; +https://github.com/)"
ATOM = "{http://www.w3.org/2005/Atom}"

STATE_WORDS = {
    "WA": ["western australia", "perth", "pilbara", "karratha", "dampier", "port hedland", "exmouth", "onslow", "broome", "kimberley",
           "carnarvon basin", "browse basin", "barrow island", "bunbury", "albany", "kwinana", "geraldton", "西澳", "珀斯"],
    "NT": ["northern territory", "darwin", "bonaparte", "beetaloo", "groote", "北领地", "达尔文"],
    "QLD": ["queensland", "gladstone", "curtis island", "brisbane", "gold coast", "great barrier reef", "townsville", "mackay", "cairns", "torres strait", "昆士兰", "大堡礁"],
    "NSW": ["new south wales", "nsw", "sydney", "newcastle", "port kembla", "illawarra", "hunter", "新南威尔士", "悉尼"],
    "VIC": ["victoria", "victorian", "melbourne", "gippsland", "bass strait", "otway", "geelong", "port of hastings", "warrnambool", "portland", "维多利亚州", "维州", "墨尔本"],
    "TAS": ["tasmania", "tasmanian", "hobart", "macquarie harbour", "storm bay", "bell bay", "king island", "marinus", "basslink", "塔斯马尼亚", "塔州"],
    "SA": ["south australia", "adelaide", "port lincoln", "spencer gulf", "eyre peninsula", "whyalla", "南澳", "阿德莱德"],
}


# --------------------------------------------------------------------------- io helpers
def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def fetch(url, timeout=45, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                "Accept-Language": "en-AU,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001 — any failure is just a skipped feed
            last = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    raise last


# --------------------------------------------------------------------------- feed parsing
def text_of(el, *names):
    for n in names:
        x = el.find(n)
        if x is not None and (x.text or "").strip():
            return html.unescape(re.sub(r"<[^>]+>", " ", x.text)).strip()
    return ""


def parse_date(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc)


def parse_feed(raw):
    """Return a list of dicts from an RSS 2.0 or Atom document."""
    root = ET.fromstring(raw)
    items = []
    for it in root.iter("item"):                                   # RSS
        link = text_of(it, "link")
        if not link:
            guid = it.find("guid")
            link = (guid.text or "").strip() if guid is not None else ""
        src = it.find("source")
        items.append({
            "title": text_of(it, "title"),
            "link": link.strip(),
            "summary": text_of(it, "description")[:400],
            "published": parse_date(text_of(it, "pubDate", "{http://purl.org/dc/elements/1.1/}date")),
            "publisher": (src.text or "").strip() if src is not None and src.text else "",
        })
    for e in root.iter(ATOM + "entry"):                            # Atom
        href = ""
        for l in e.findall(ATOM + "link"):
            if l.get("rel", "alternate") == "alternate":
                href = l.get("href", "")
                break
        items.append({
            "title": text_of(e, ATOM + "title"),
            "link": href.strip(),
            "summary": text_of(e, ATOM + "summary", ATOM + "content")[:400],
            "published": parse_date(text_of(e, ATOM + "published", ATOM + "updated")),
            "publisher": "",
        })
    return items


def norm_title(t):
    t = re.sub(r"\s+[-–|]\s+[^-–|]{2,60}$", "", t or "")           # drop a trailing " - Publisher"
    return re.sub(r"[^a-z0-9一-鿿]+", " ", t.lower()).strip()


def split_publisher(title, feed_publisher, feed_url):
    """Google News appends ' - Publisher' to the headline; move it into its own field."""
    if feed_publisher:
        return title, feed_publisher
    m = re.search(r"\s+[-–]\s+([^-–]{2,60})$", title or "")
    if m and "news.google" in feed_url:
        return title[: m.start()].strip(), m.group(1).strip()
    return title, ""


def tag_item(title, summary, operator_names, rules, projects, default_cat):
    blob = f"{title} {summary}"
    low = blob.lower()
    ops = sorted({full for k, full in operator_names.items() if re.search(r"\b" + re.escape(k) + r"\b", low)})
    states = sorted({s for s, words in STATE_WORDS.items() if any(w in low for w in words)})
    cats, subs = [], []
    for r in rules:
        kws = r.get("keywords_en", []) + r.get("keywords_zh", [])
        if any((k.lower() in low) if k.isascii() else (k in blob) for k in kws if k):
            if r["category"] not in cats:
                cats.append(r["category"])
            if r.get("subcategory") and r["subcategory"] not in subs:
                subs.append(r["subcategory"])
    if not cats and default_cat:
        cats = [default_cat]
    projs = sorted({p["project_id"] for p in projects if p.get("_key") and re.search(r"\b" + re.escape(p["_key"]) + r"\b", low)})
    return ops, states, cats, subs, projs


# --------------------------------------------------------------------------- main
def main():
    sources = load_json(os.path.join(DATA, "news_sources.json"), [])
    meta = load_json(os.path.join(DATA, "meta.json"), {})
    operators = load_json(os.path.join(DATA, "operators.json"), [])
    op_names = [o.get("name") for o in operators]
    rules = load_json(os.path.join(DATA, "news_rules.json"), [])
    projects = load_json(os.path.join(DATA, "projects.json"), [])
    STOP = {"north", "south", "east", "west", "greater", "great", "port", "southern", "northern", "eastern", "western", "offshore",
            "australian", "australia", "sydney", "perth", "adelaide", "melbourne", "victorian", "victoria", "gold", "tasmanian", "tasmania",
            "queensland", "darwin", "south-east", "commonwealth", "spencer", "torres", "northern", "eastern", "central", "bass", "otway",
            "gippsland", "browse", "carnarvon", "bonaparte", "heard", "pacific", "coral", "indigo", "southern", "japan-guam-australia"}
    for p in projects:   # a project matches on its distinctive name ("Scarborough", "Marinus Link"), not on generic words
        k = re.split(r"[(/（]| and | - ", p.get("name") or "")[0].strip().lower()
        k = re.sub(r"\b(lng|project|offshore wind|fishery|plant|field|fields|gas|oil|ccs|cable|system|terminal|desalination|energy|stage \d+|train \d+)\b", "", k)
        k = re.sub(r"\s+", " ", k).strip()
        first = k.split(" ")[0] if k else ""
        p["_key"] = k if len(k) >= 8 and " " in k else (first if len(first) >= 6 and first not in STOP else "")
        if p["_key"] in {"gladstone", "gold coast", "eyre peninsula", "coral sea", "south pacific", "north-west", "east coast supply",
                         "victorian renewable", "seq second", "sydney expansion", "eastern tuna", "australia-japan"}:
            p["_key"] = ""
    op_keys = {}
    for o in operators:
        n = re.split(r"[(（]", o.get("name") or "")[0]
        n = re.sub(r"\b(energy|australia|australian|limited|ltd|pty|group|holdings|inc|plc|corporation|company|power solutions)\b", "", n, flags=re.I).strip()
        if len(n) >= 4:
            op_keys[n.lower()] = o["name"]

    existing = load_json(NEWS_PATH, {"items": []})
    items = {i["link"]: i for i in existing.get("items", []) if i.get("link")}
    seen_titles = {norm_title(i.get("title", "")) for i in items.values()}
    before = len(items)

    now = dt.datetime.now(dt.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    added, errors, per_source = 0, [], {}

    for s in sources:
        sid = s.get("source_id") or s.get("url", "")[:30]
        if not s.get("enabled", True) or s.get("type", "rss") != "rss":
            continue
        try:
            feed_items = parse_feed(fetch(s["url"]))
        except Exception as e:  # noqa: BLE001
            msg = f"{sid}: {type(e).__name__}: {str(e)[:120]}"
            errors.append(msg)
            print("  skip " + msg, file=sys.stderr)
            continue

        kws = [k.lower() for k in (s.get("filter_keywords") or [])]
        n = 0
        for it in feed_items:
            if not it["title"] or not it["link"]:
                continue
            if kws and not any(k in (it["title"] + " " + it["summary"]).lower() for k in kws):
                continue
            nt = norm_title(it["title"])
            if it["link"] in items or (nt and nt in seen_titles):
                continue
            title, publisher = split_publisher(it["title"], it["publisher"], s["url"])
            pub = it["published"] or now
            ops, states, cats, subs, projs = tag_item(title, it["summary"], op_keys, rules, projects, s.get("default_category"))
            items[it["link"]] = {
                "title": title,
                "link": it["link"],
                "summary": it["summary"],
                "publisher": publisher,
                "published": pub.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "source_id": s.get("source_id"),
                "language": s.get("language", "en"),
                "operators": ops,
                "states": states,
                "categories": cats,
                "subcategories": subs,
                "projects": projs,
                "first_seen": stamp,
            }
            seen_titles.add(nt)
            n += 1
        per_source[sid] = {"in_feed": len(feed_items), "new": n}
        added += n
        print(f"  {sid:18s} {len(feed_items):4d} in feed, {n:3d} new")

    # The archive only ever grows — no pruning, no cap.
    out = sorted(items.values(), key=lambda i: i["published"], reverse=True)
    # re-tag the archive with the current rules so edits to NewsRules apply backwards
    for i in out:
        o2, s2, c2, sb2, p2 = tag_item(i.get("title", ""), i.get("summary", ""), op_keys, rules, projects, None)
        i["operators"], i["states"], i["subcategories"], i["projects"] = o2, s2, sb2, p2
        i["categories"] = c2 or i.get("categories", [])

    by_month = {}
    for i in out:
        by_month[i["published"][:7]] = by_month.get(i["published"][:7], 0) + 1

    os.makedirs(DATA, exist_ok=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as fh:
        json.dump({
            "fetched_at": stamp,
            "added_this_run": added,
            "total_items": len(out),
            "earliest": out[-1]["published"][:10] if out else None,
            "errors": errors,
            "per_source": per_source,
            "by_month": dict(sorted(by_month.items(), reverse=True)),
            "note": "Append-only archive. meta.news_days_to_keep controls the site's default window, not storage.",
            "items": out,
        }, fh, ensure_ascii=False, indent=1)

    size_kb = os.path.getsize(NEWS_PATH) / 1024
    print(f"news.json: {len(out)} items ({before} before, {added} new), {len(errors)} feed errors, {size_kb:.0f} KB")
    if errors and added == 0 and before == 0:
        print("::warning::no headlines collected and no existing archive — check the NewsSources sheet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
