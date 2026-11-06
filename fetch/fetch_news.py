#!/usr/bin/env python3
"""ดึงข่าวร้อน -> POST ingest เข้า Apps Script -> สั่งให้ลุงเล่า (retellPending)

ใช้แค่ stdlib · ห้ามพิมพ์เนื้อหาข่าวลง log (repo สาธารณะ) พิมพ์แค่จำนวน
env: API_URL, API_KEY
"""
import hashlib
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (compatible; song-khao/1.0; +https://github.com/beethayu/song-khao)"
HT = "{https://trends.google.com/trending/rss}"

# คำที่ตัดทิ้ง (บันเทิง/กีฬา) แบบหยาบ ๆ
SKIP = re.compile(
    r"ฟุตบอล|พรีเมียร์ลีก|ลีกสูงสุด|บอลโลก|ผลบอล|นักเตะ|แมนยู|ลิเวอร์พูล|เรอัล|บาร์เซโลนา|"
    r"ละคร|ซีรีส์|ซีรีย์|นักแสดง|ดารา|คอนเสิร์ต|เพลงใหม่|อัลบั้ม|ศิลปิน|หนังใหม่|ภาพยนตร์|เรตติ้ง|เกมโชว์|"
    r"มวยไทย|ไฮไลท์|ชิงแชมป์|โอลิมปิก|"
    r"\b(nba|nfl|mlb|nhl|ufc|wwe|premier league|champions league|box office|album|concert|"
    r"trailer|season finale|episode|grammy|oscar|emmy|taylor swift|netflix)\b",
    re.I,
)


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def mid(*parts):
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


def parse_traffic(s):
    """'200K+' / '2M+' / '500+' -> int"""
    m = re.match(r"\s*([\d.,]+)\s*([KkMm]?)", s or "")
    if not m:
        return 0
    n = float(m.group(1).replace(",", ""))
    return int(n * {"": 1, "k": 1e3, "m": 1e6}[m.group(2).lower()])


def fmt_num(n):
    if n >= 1e6:
        return f"{n/1e6:.1f}M".replace(".0M", "M")
    if n >= 1e3:
        return f"{n/1e3:.0f}K"
    return str(n)


def trends(geo, region, label):
    """Google Trends RSS: ค้นหาพุ่ง + ข่าวประกอบ (approx_traffic = ตัววัดปฏิสัมพันธ์)"""
    root = ET.fromstring(get(f"https://trends.google.com/trending/rss?geo={geo}"))
    out = []
    for it in root.iter("item"):
        kw = (it.findtext("title") or "").strip()
        traffic = parse_traffic(it.findtext(HT + "approx_traffic"))
        news = it.findall(HT + "news_item")
        if news:
            n = news[0]
            title = (n.findtext(HT + "news_item_title") or kw).strip()
            url = (n.findtext(HT + "news_item_url") or "").strip()
            src = (n.findtext(HT + "news_item_source") or "").strip()
            snip = " / ".join((x.findtext(HT + "news_item_title") or "").strip() for x in news[:3])
        else:
            title, url, src, snip = kw, "", "", ""
        out.append(dict(
            id=mid(region, kw), region=region, title=title, source=src or "Google Trends",
            url=url, raw=traffic, metric=f"ค้นหา {fmt_num(traffic)}+ ({label})" if traffic else label,
            snippet=snip, tag=kw,
        ))
    return out


def gnews(query, region, hl, gl, ceid, label):
    """Google News RSS ค้นหา (ไม่มีตัวเลขปฏิสัมพันธ์ ใช้ลำดับแทน)"""
    q = urllib.parse.quote(query)
    root = ET.fromstring(get(f"https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={ceid}"))
    out = []
    for i, it in enumerate(root.iter("item")):
        title = (it.findtext("title") or "").strip()
        src = (it.findtext("source") or "").strip()
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        out.append(dict(
            id=mid(region, title), region=region, title=title, source=src,
            url=(it.findtext("link") or "").strip(), raw=max(50 - i, 1), metric=label,
            snippet="", tag=query.split(" ")[0],
        ))
        if i >= 24:
            break
    return out


def reddit(sub, region):
    data = json.loads(get(f"https://www.reddit.com/r/{sub}/top.json?t=day&limit=25"))
    out = []
    for c in data["data"]["children"]:
        d = c["data"]
        if d.get("over_18") or d.get("stickied"):
            continue
        raw = d.get("num_comments", 0) * 5 + d.get("ups", 0) // 10
        out.append(dict(
            id=mid(region, d["id"]), region=region, title=d["title"].strip(),
            source=f"Reddit r/{sub}", url="https://www.reddit.com" + d.get("permalink", ""),
            raw=raw, metric=f"คอมเมนต์ {fmt_num(d.get('num_comments', 0))} · โหวต {fmt_num(d.get('ups', 0))}",
            snippet=(d.get("selftext") or "")[:300], tag=f"r/{sub}",
        ))
    return out


SOURCES = [
    ("trends-TH", lambda: trends("TH", "th", "ไทย")),
    ("gnews-drama", lambda: gnews("ดราม่า when:1d", "th", "th", "TH", "TH:th", "ข่าวดราม่า")),
    ("gnews-net", lambda: gnews("ชาวเน็ต when:1d", "th", "th", "TH", "TH:th", "ชาวเน็ตวิจารณ์")),
    ("trends-US", lambda: trends("US", "world", "สหรัฐฯ")),
    ("trends-GB", lambda: trends("GB", "world", "อังกฤษ")),
    ("trends-IN", lambda: trends("IN", "world", "อินเดีย")),
    ("trends-AU", lambda: trends("AU", "world", "ออสเตรเลีย")),
    ("reddit-worldnews", lambda: reddit("worldnews", "world")),
    ("reddit-news", lambda: reddit("news", "world")),
]


def collect():
    items, seen = [], set()
    for name, fn in SOURCES:
        try:
            got = [x for x in fn() if x["title"] and not SKIP.search(x["title"] + " " + x["tag"])]
        except Exception as e:  # ข้ามแหล่งที่พัง ไม่ล้มทั้งงาน
            print(f"{name}: ล้มเหลว ({type(e).__name__})")
            continue
        # คะแนนตามอันดับในแหล่งเดียวกัน (คนละหน่วยเทียบกันตรง ๆ ไม่ได้)
        got.sort(key=lambda x: x["raw"], reverse=True)
        n = max(len(got), 1)
        kept = 0
        for rank, x in enumerate(got):
            if x["id"] in seen:
                continue
            seen.add(x["id"])
            x["score"] = round(100 - rank * (100 / n) + math.log10(x["raw"] + 1), 2)
            x.pop("raw", None)
            items.append(x)
            kept += 1
        print(f"{name}: {kept} รายการ")
    return items


def call(fn, args):
    body = json.dumps({"fn": fn, "args": args, "k": os.environ["API_KEY"]}).encode("utf-8")
    req = urllib.request.Request(os.environ["API_URL"], data=body, method="POST",
                                 headers={"Content-Type": "text/plain;charset=utf-8", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.loads(r.read().decode("utf-8"))
    if not res.get("ok"):
        raise RuntimeError(res.get("error", "api error"))
    return res["result"]


def main():
    if not os.environ.get("API_URL") or not os.environ.get("API_KEY"):
        print("ไม่มี API_URL / API_KEY (ตั้งใน Secrets)")
        return 1
    items = collect()
    print(f"รวมทั้งหมด {len(items)} รายการ")
    if not items:
        return 1
    print("ingest:", call("ingest", [items]))
    for i in range(4):  # ให้ลุงเล่าทีละ 6 ข่าว สูงสุด 24 ข่าวต่อรอบ
        r = call("retellPending", [6])
        print(f"retell รอบ {i + 1}:", r)
        if r.get("left", 0) == 0 or r.get("done", 0) == 0:
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
