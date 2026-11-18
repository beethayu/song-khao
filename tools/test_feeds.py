import urllib.request, urllib.parse, xml.etree.ElementTree as ET, re
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Language": "th,en;q=0.8"}), timeout=20).read(3_000_000)
for q in ["อ้อย ชาวไร่", "กรมอุตุนิยมวิทยา เตือน", "ธ.ก.ส. เกษตรกร", "ราคาน้ำมัน", "เงินช่วยเหลือ ลงทะเบียน"]:
    u = "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": q, "format": "rss", "setlang": "th", "cc": "TH", "qft": "sortbydate=\"1\""})
    try:
        r = ET.fromstring(get(u)); its = list(r.iter("item"))
        print(f"BING {q}: {len(its)}")
        ok = 0
        for it in its[:6]:
            l = it.findtext("link") or ""
            real = urllib.parse.parse_qs(urllib.parse.urlparse(l).query).get("url", [l])[0]
            src = it.findtext("{https://www.bing.com/news/search?q=" + "}Source") or ""
            pd = it.findtext("pubDate") or ""
            try:
                h = get(real).decode("utf-8", "ignore"); n = len(re.findall(r"<p[^>]*>", h)); st = f"read p={n}"
            except Exception as e:
                st = "readfail " + type(e).__name__ + str(e)[:30]
            print("   ", urllib.parse.urlparse(real).netloc, pd[:16], st)
    except Exception as e:
        print(f"BING {q}: FAIL {type(e).__name__} {str(e)[:60]}")
