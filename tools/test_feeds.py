import urllib.request, xml.etree.ElementTree as ET, re
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
C = """thaipbs https://www.thaipbs.or.th/rss/news
thaipbs2 https://www.thaipbs.or.th/rss
bkkbiz https://www.bangkokbiznews.com/rss/feed/news
bkkbiz2 https://www.bangkokbiznews.com/rss
than https://www.thansettakij.com/rss/feed/news
than2 https://www.thansettakij.com/rss
pracha https://www.prachachat.net/feed
mgr https://mgronline.com/rss/latest
mgr2 https://mgronline.com/rss
siamrath https://siamrath.co.th/rss.xml
naewna https://www.naewna.com/rss.php
komchad https://www.komchadluek.net/rss
nation https://www.nationtv.tv/rss
nation2 https://www.nationthailand.com/rss
tna https://tna.mcot.net/feed
tnn https://www.tnnthailand.com/rss
pptv https://www.pptvhd36.com/rss/news
amarin https://www.amarintv.com/rss
ch7 https://news.ch7.com/rss
ch3 https://ch3plus.com/news/rss
thairath https://www.thairath.co.th/rss/news
dailynews https://www.dailynews.co.th/rss/
hfocus https://www.hfocus.org/rss.xml
tmd https://www.tmd.go.th/api/xml/rss
prd https://www.prd.go.th/th/rss
moac https://www.moac.go.th/rss
ocsb https://www.ocsb.go.th/feed/
""".split("\n")
for line in C:
    if not line.strip(): continue
    n, u = line.split()
    try:
        b = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"}), timeout=20).read(3_000_000)
        r = ET.fromstring(b); its = list(r.iter("item")) or list(r.iter("{http://www.w3.org/2005/Atom}entry"))
        l = (its[0].findtext("link") or "") if its else ""
        print(f"OK {n} {len(its)} {l[:70]}")
    except Exception as e:
        print(f"NO {n} {type(e).__name__} {str(e)[:50]}")
