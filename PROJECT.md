# ส่งข่าว (song-khao)

แอปรวมข่าวดราม่า/ประเด็นร้อน ไว้เป็นวัตถุดิบทำคอนเทนต์ · เจ้าของ: beethayu (ทำทุกอย่างบน iPhone ตอบไทยเสมอ)
ชื่อในแอป: **ส่งข่าว** · repo: `song-khao` · คาแรกเตอร์ "ลุง" เล่าข่าวสำนวนบ้าน ๆ

## เป้าหมาย
- เห็นว่าวันนี้อะไรร้อน/คนปฏิสัมพันธ์เยอะ (ไทย + โลก, ไม่เน้นบันเทิง/กีฬา, ไม่เน้นญี่ปุ่น)
- ให้ลุงเล่าใหม่ทีละข่าว เอาไปปั้นคอนเทนต์ต่อ (ปุ่มคัดลอก)
- ช่องแชทถามลุงเพิ่มเกี่ยวกับข่าวนั้น
- **อ่านได้แม้โควตา Claude หมด**: ใช้ Gemini ฝั่ง Apps Script, ข่าวที่ลุงเล่าแล้วเก็บในชีต + แคชในเครื่อง
- ภายหลัง: โซนสินค้า/ลิงก์ค่าคอม (แยกโซน ไม่แทรกกลางข่าวดราม่า, ต้องบอกว่าเป็นลิงก์ค่าคอม)

## สถาปัตยกรรม
```
GitHub Actions cron (fetch-news.yml, ทุก 2 ชม.)
  └ fetch/fetch_news.py ดึงแหล่งข่าว → POST ingest เข้า Apps Script → เรียก retellPending (Gemini เล่าสำนวนลุง)
Apps Script web app (gas/Code.gs)  ← deploy ด้วย clasp ผ่าน deploy-gas.yml
  └ Google Sheet "ส่งข่าว" (สร้างเองครั้งแรก เก็บ id ใน Script Properties SHEET_ID)
index.html (GitHub Pages)  → POST text/plain {fn,args,k} → {ok,result}
```
- API: ฟังก์ชันลงท้าย `_` ถูกบล็อก · รหัส API_KEY, GEMINI_KEY อยู่ใน Script Properties
- Secrets ใน GitHub (Actions): `CLASPRC_JSON`, `SCRIPT_ID`, `DEPLOYMENT_ID` (deploy-gas) · `API_URL`, `API_KEY` (fetch-news)

## แหล่งข่าว (v1) — ยังไม่เคยรันจริง ดึงจาก Actions เพราะ workspace โหลดเว็บภายนอกไม่ได้
- ไทย: Google Trends RSS (geo=TH, มี approx_traffic = ตัววัดปฏิสัมพันธ์) + Google News RSS ค้น "ดราม่า/ชาวเน็ต"
- โลก: Google Trends RSS (US, GB, IN, AU) + Reddit r/worldnews, r/news (top day; Reddit อาจบล็อก IP ของ Actions → ข้ามได้ ไม่ล้มทั้งงาน)
- คัดบันเทิง/กีฬาออกด้วยคำต้องห้ามแบบหยาบ ๆ (ปรับในไฟล์ fetch)
- X (Twitter): ยังไม่ทำ ต้องจ่าย API · ทำถ้าผู้ใช้ตกลงจ่าย
- ห้ามพิมพ์เนื้อหาข่าวใน log Actions (repo สาธารณะ) พิมพ์แค่จำนวน

## กติกาลุงเล่า
- เล่าเฉพาะข้อเท็จจริงจากหัวข้อ/สรุปที่ได้ ไม่แต่งเติม ไม่กล่าวหาคนจริง ใช้ "ตามข่าวว่า…" · ข้อมูลน้อยให้บอกตรง ๆ ว่ารู้แค่นี้
- แชท: ใช้ข่าวที่เลือก + หัวข้อข่าวในหน้า เป็นบริบท ห้ามแต่งตัวเลข

## สถานะล่าสุด
- (รอบ 1, 2026-11-06) เขียนโค้ดครบ: gas/Code.gs, fetch/fetch_news.py, 2 workflows, index.html (แท็บ ไทย/โลก/เก็บไว้/แชท/ตั้งค่า)
- ทดสอบแล้ว: หน้าเว็บด้วย playwright 390×844 + API จำลอง (เปิดข่าว/ให้ลุงเล่า/แชท/เก็บ/ตั้งค่าผ่าน) · ตัวอ่าน Trends ด้วย XML จำลอง · syntax gas/py/js
- **ยังไม่เคยทดสอบกับของจริง**: การดึง RSS/Reddit, Gemini (ชื่อรุ่น gemini-3.5-flash / -flash-lite + thinkingLevel minimal จากสกิล — ถ้า 400 ให้ลองปรับ), clasp deploy, Pages
- deploy-gas ถ้ายังไม่มี Secrets จะข้ามพร้อมคำเตือน (ไม่ล้ม)
- **2026-11-06 clasp push ขึ้น Apps Script สำเร็จแล้ว** (2 ไฟล์) · CLASPRC_JSON ของผู้ใช้เป็นรูปแบบ `tokens` → ต้องใช้ clasp@3 (clasp@2 ล้มด้วย "reading 'access_token'") · workflow เลือกเวอร์ชันเองตามคีย์ · ถัดไป: ผู้ใช้ deploy เว็บแอปครั้งแรกในหน้า Apps Script แล้วตั้ง Secret DEPLOYMENT_ID
- รอผู้ใช้: สร้าง Apps Script โปรเจกต์ใหม่ + ตั้ง Secrets + Script Properties + deploy web app + เปิด Pages (ดูขั้นตอนด้านล่าง)

## ขั้นที่ผู้ใช้ต้องทำ (Claude ทำเองไม่ได้)
1. script.google.com → โปรเจกต์ใหม่ ตั้งชื่อ "ส่งข่าว" → Project settings → คัดลอก Script ID
2. GitHub repo → Settings → Secrets → Actions: `SCRIPT_ID`, `CLASPRC_JSON` (ค่าเดียวกับ repo อื่น)
3. push โค้ดแล้ว deploy-gas จะ push โค้ดขึ้น Apps Script · ในหน้า Apps Script: Deploy → New deployment → Web app (Execute as: Me, Access: Anyone) → คัดลอก Web app URL + Deployment ID → ตั้ง Secret `DEPLOYMENT_ID`
4. Apps Script → Project settings → Script properties: `API_KEY` (ตั้งเอง), `GEMINI_KEY`
5. รันฟังก์ชัน `authorize` หนึ่งครั้งในหน้า Apps Script (ให้สิทธิ์ชีต + เรียกเว็บ)
6. Secrets เพิ่ม: `API_URL` (Web app URL), `API_KEY` · Settings → Pages → Deploy from branch main / root
7. Actions → "ดึงข่าว" → Run workflow ครั้งแรก · เปิดแอป → ตั้งค่า → ใส่ API URL + API KEY

## รายการรอทำ
- โซนสินค้า "ลุงแนะนำ" + ลิงก์ค่าคอม (หลังข่าว/แชทเวิร์ก)
- ต่อ X API (ต้องจ่าย)
- ปุ่มโพสต์/แชร์ไปแคปชั่น Facebook/TikTok/LINE (สร้างแคปชั่นให้ลุง)
- ตั้งเวลาแจ้งเตือนข่าวร้อนผ่าน Reminders

## สิ่งที่ผู้ใช้ชอบ (ใช้ซ้ำ)
ดู skill `beethayu-mobile-app` · เพิ่มของใหม่ที่ผู้ใช้บอกลงที่นี่
- ตอบไทย สั้น ทีละขั้น · ความจำสั้น ชอบขั้นตอนละเอียดเป็นข้อ ๆ
- ประหยัดโควตา: ทำแล้ว push เลย ไม่ verify ซ้ำเกินจำเป็น
