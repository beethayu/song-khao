#!/usr/bin/env python3
"""ดึงข่าวร้อน -> POST ingest เข้า Apps Script -> สั่งให้ลุงเล่า (retellPending)

ใช้แค่ stdlib · ห้ามพิมพ์เนื้อหาข่าวลง log (repo สาธารณะ) พิมพ์แค่จำนวน
env: API_URL, API_KEY
"""
import base64
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

UA = "Mozilla/5.0 (compatible; song-khao/1.0; +https://github.com/beethayu/song-khao)"
HT = "{https://trends.google.com/trending/rss}"

# คำที่ตัดทิ้ง (บันเทิง/กีฬา) แบบหยาบ ๆ
SKIP = re.compile(
    r"หวย|เลขเด็ด|ตรวจสลาก|ผลสลาก|สลากกินแบ่ง|ฟุตบอล|พรีเมียร์ลีก|ลีกสูงสุด|บอลโลก|ผลบอล|นักเตะ|แมนยู|ลิเวอร์พูล|เรอัล|บาร์เซโลนา|"
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


def gnews(query, region, hl, gl, ceid, label, limit=25, tag=None):
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
            snippet="", tag=tag or query.split(" ")[0],
        ))
        if i >= limit - 1:
            break
    return out


def rss(url, region, label, limit=25):
    """RSS ของสำนักข่าวโดยตรง (ลิงก์จริง อ่านเนื้อข่าวไปสรุปได้)"""
    root = ET.fromstring(get(url))
    out = []
    for i, it in enumerate(root.iter("item")):
        title = re.sub(r"\s+", " ", (it.findtext("title") or "")).strip()
        link = (it.findtext("link") or "").strip()
        desc = re.sub(r"<[^>]+>", " ", it.findtext("description") or "")
        desc = re.sub(r"\s+", " ", desc).strip()[:300]
        if not title or not link:
            continue
        out.append(dict(
            id=mid(region, title), region=region, title=title, source=label, url=link,
            raw=max(50 - i, 1), metric=f"ข่าวเด่น · {label}", snippet=desc, tag=label,
        ))
        if len(out) >= limit:
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


# ข่าวหมวด (region "near") ค้นจาก Google News RSS · tag = รหัสหมวด (alert/welfare/econ/protest/ent) แหล่งละ 8 ข่าว
NEAR_Q = [
    ("alert", "เตือนภัย มิจฉาชีพ when:2d", "เตือนภัยมิจฉาชีพ"),
    ("alert", "ตำรวจไซเบอร์ เตือน when:3d", "ตำรวจไซเบอร์เตือน"),
    ("alert", "สคบ. เตือน when:3d", "สคบ.เตือน"),
    ("alert", "ปภ. เตือน when:1d", "ปภ.เตือน"),
    ("alert", "กรมอุตุนิยมวิทยา เตือน ฝนตกหนัก when:1d", "เตือนสภาพอากาศ"),
    ("welfare", "บัตรสวัสดิการแห่งรัฐ when:3d", "บัตรสวัสดิการ"),
    ("welfare", "เงินช่วยเหลือ ลงทะเบียน when:3d", "เงินช่วยเหลือ"),
    ("welfare", "สปสช. สิทธิ บัตรทอง when:3d", "สิทธิสุขภาพ"),
    ("econ", "ค่าครองชีพ when:2d", "ค่าครองชีพ"),
    ("econ", "ราคาน้ำมัน ปรับ when:1d", "ราคาน้ำมัน"),
    ("econ", "ค่าไฟ งวดใหม่ when:3d", "ค่าไฟ"),
    ("protest", "ชุมนุม ประท้วง when:2d", "ชุมนุม"),
    ("protest", "ม็อบ when:2d", "ม็อบ"),
    ("protest", "สนธิ ลิ้มทองกุล when:3d", "สนธิ"),
    ("ent", "ดราม่า ดารา when:1d", "ดราม่าบันเทิง"),
    ("ent", "ข่าวบันเทิง when:1d", "ข่าวบันเทิง"),
]
SOURCES += [("gnews-near-" + c + "-" + str(i), (lambda q=q, l=l, c=c: gnews(q, "near", "th", "TH", "TH:th", l, 8, c)))
            for i, (c, q, l) in enumerate(NEAR_Q)]


RSS_TH = [
    ("thairath", "https://www.thairath.co.th/rss/news", "ไทยรัฐ"),
    ("khaosod", "https://www.khaosod.co.th/feed", "ข่าวสด"),
    ("matichon", "https://www.matichon.co.th/feed", "มติชน"),
    ("dailynews", "https://www.dailynews.co.th/feed/", "เดลินิวส์"),
    ("mthai", "https://news.mthai.com/feed", "MThai"),
    ("sanook", "https://www.sanook.com/news/rss/", "Sanook"),
]
RSS_WORLD = [
    ("bbc", "https://feeds.bbci.co.uk/news/world/rss.xml", "BBC News"),
    ("guardian", "https://www.theguardian.com/world/rss", "The Guardian"),
    ("aljazeera", "https://www.aljazeera.com/xml/rss/all.xml", "Al Jazeera"),
    ("npr", "https://feeds.npr.org/1004/rss.xml", "NPR"),
    ("dw", "https://rss.dw.com/rdf/rss-en-all", "DW"),
]
SOURCES += [("rss-" + n, (lambda u=u, l=l: rss(u, "th", l))) for n, u, l in RSS_TH]
SOURCES += [("rss-" + n, (lambda u=u, l=l: rss(u, "world", l))) for n, u, l in RSS_WORLD]


def collect():
    items, seen = [], set()
    for name, fn in SOURCES:
        try:
            got = [x for x in fn() if x["title"] and re.search(r"[A-Za-zก-๙]", x["title"])
                   and (x["tag"] == "ent" or not SKIP.search(x["title"] + " " + x["tag"]))]
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


BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch_html(url, timeout=15, limit=1_500_000):
    req = urllib.request.Request(url, headers={
        "User-Agent": BROWSER_UA, "Accept": "text/html,*/*", "Accept-Language": "th,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(limit)
        cs = r.headers.get_content_charset() or "utf-8"
    return raw.decode(cs, errors="replace")


def resolve_gnews(url):
    """ลิงก์ Google News -> ลิงก์เว็บข่าวจริง (วิธีไม่เป็นทางการ พังได้ ต้องครอบ try)"""
    m = re.search(r"/(?:rss/)?articles/([^?/#]+)", url)
    if not m:
        return url
    gid = m.group(1)
    try:  # รูปแบบเก่า: ลิงก์จริงฝังอยู่ใน base64
        txt = base64.urlsafe_b64decode(gid + "=" * (-len(gid) % 4)).decode("latin1")
        mm = re.search(r"https?://[\x21-\x7e]+", txt)
        if mm and "AU_yqL" not in txt:
            return mm.group(0)
    except Exception:
        pass
    page = fetch_html(f"https://news.google.com/articles/{gid}", limit=600_000)
    sg = re.search(r'data-n-a-sg="([^"]+)"', page)
    ts = re.search(r'data-n-a-ts="([^"]+)"', page)
    if not sg or not ts:
        raise ValueError("no-signature")
    inner = ('["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
             f'"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{gid}",{ts.group(1)},"{sg.group(1)}"]')
    payload = "f.req=" + urllib.parse.quote(json.dumps([[["Fbv4je", inner]]]))
    req = urllib.request.Request(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute", data=payload.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": BROWSER_UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = r.read().decode("utf-8", errors="replace")
    parsed = json.loads(resp.split("\n\n")[1])
    return json.loads(parsed[0][2])[1]


class _Paras(HTMLParser):
    SKIP = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg"}

    def __init__(self):
        super().__init__()
        self.skip, self.inp, self.cur, self.paras, self.meta = 0, False, [], [], ""

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "p" and not self.skip:
            self.inp, self.cur = True, []
        elif tag == "meta" and not self.meta:
            a = dict(attrs)
            if a.get("property") == "og:description" or a.get("name") == "description":
                self.meta = (a.get("content") or "").strip()

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag == "p" and self.inp:
            t = " ".join("".join(self.cur).split())
            if len(t) >= 40:
                self.paras.append(t)
            self.inp = False

    def handle_data(self, d):
        if self.inp and not self.skip:
            self.cur.append(d)


def article_text(url):
    """อ่านเนื้อข่าวไปสรุปเท่านั้น ไม่เก็บ ไม่แสดงเนื้อเต็ม"""
    p = _Paras()
    p.feed(fetch_html(url))
    body = "\n".join(p.paras)
    if p.meta:
        body = p.meta + "\n" + body
    return body[:7000]


def facts_step():
    try:
        todo = call("needFacts", [12])
    except Exception as e:
        print("ขอรายการข่าวย่อล้มเหลว:", str(e)[:100])
        return
    got = ok = bad = g_try = g_ok = 0
    for it in todo:
        text, via_g = "", "news.google.com" in it["url"]
        try:
            if via_g:
                g_try += 1
                time.sleep(1)
            url = resolve_gnews(it["url"]) if via_g else it["url"]
            text = article_text(url)
            if len(text) >= 200:
                got += 1
                g_ok += 1 if via_g else 0
        except Exception as e:
            bad += 1
            print("อ่านเนื้อข่าวไม่ได้:", type(e).__name__, str(e)[:40])
        try:
            r = call("factsFromText", [it["id"], text])
            ok += 1 if r.get("has") else 0
        except Exception as e:
            print("สรุปข่าวย่อล้มเหลว:", str(e)[:100])
    print(f"ข่าวย่อ: ขอ {len(todo)} · อ่านเนื้อได้ {got} · สรุปสำเร็จ {ok} · อ่านไม่ได้ {bad} · ลิงก์ Google News {g_ok}/{g_try}")


def call(fn, args):
    body = json.dumps({"fn": fn, "args": args, "k": os.environ["API_KEY"]}).encode("utf-8")
    req = urllib.request.Request(os.environ["API_URL"], data=body, method="POST",
                                 headers={"Content-Type": "text/plain;charset=utf-8", "User-Agent": UA})
    for attempt in range(3):  # Apps Script ตอบ 502/ช้าเป็นบางครั้ง ลองใหม่ได้ (ทุกคำสั่งส่งซ้ำได้ไม่เบิ้ล)
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                res = json.loads(r.read().decode("utf-8"))
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == 2:
                raise
            print(f"{fn}: เรียกไม่ติด ({type(e).__name__}) ลองใหม่")
            time.sleep(8 * (attempt + 1))
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
    for i in range(3):  # แปลหัวข้อข่าวโลกเป็นไทยทีละ 20 หัวข้อ (พลาดไม่ล้มทั้งงาน)
        try:
            r = call("translatePending", [20])
        except Exception as e:
            print("แปลหัวข้อล้มเหลว:", str(e)[:80])
            break
        print(f"แปล รอบ {i + 1}:", r)
        if r.get("left", 0) == 0 or r.get("done", 0) == 0:
            break
    for i in range(6):  # ให้คะแนนทีละ 25 หัวข้อ (พลาดไม่ล้มทั้งงาน)
        try:
            r = call("scorePending", [25])
        except Exception as e:
            print("ให้คะแนนล้มเหลว:", str(e)[:80])
            break
        print(f"คะแนน รอบ {i + 1}:", r)
        if r.get("left", 0) == 0 or r.get("done", 0) == 0:
            break
    facts_step()
    for i in range(6):  # ให้ลุงเล่าทีละ 6 ข่าว สูงสุด 36 ข่าวต่อรอบ
        try:
            r = call("retellPending", [6])
        except Exception as e:
            print("ลุงเล่าล้มเหลว:", str(e)[:120])
            break
        print(f"retell รอบ {i + 1}:", r)
        if r.get("left", 0) == 0 or r.get("done", 0) == 0:
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
