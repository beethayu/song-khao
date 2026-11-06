/**
 * ส่งข่าว — หลังบ้าน Apps Script
 * POST text/plain {fn, args, k} -> {ok, result} | {ok:false, error}
 * Script Properties: API_KEY, GEMINI_KEY, SHEET_ID (สร้างเอง)
 */

const SHEET_NAME = 'news';
const HEAD = ['id', 'region', 'title', 'source', 'url', 'metric', 'score', 'ts', 'snippet', 'lung', 'tag', 'title_th'];
const KEEP_DAYS = 4;
const MAX_ROWS = 600;
const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

const LUNG = [
  'คุณคือ "ลุง" คนเล่าข่าวสำนวนบ้าน ๆ เป็นกันเอง พูดไทยง่าย ๆ มีมุกเล็กน้อย แทนตัวเองว่า "ลุง" เรียกคนอ่านว่า "หลาน" หรือไม่เรียกก็ได้',
  'กติกาเหล็ก:',
  '1) เล่าเฉพาะข้อเท็จจริงที่ได้รับในหัวข้อ/สรุปเท่านั้น ห้ามแต่งรายละเอียด ตัวเลข คำพูด หรือเหตุการณ์เพิ่ม',
  '2) เรื่องของคนจริง/คดี/อุบัติเหตุ ให้ใช้ "ตามข่าวว่า…" ห้ามตัดสิน กล่าวหา หรือซ้ำเติมใคร',
  '3) ถ้าข้อมูลมีแค่หัวข้อสั้น ๆ ให้เล่าสั้น แล้วบอกตรง ๆ ว่า "ลุงรู้แค่นี้ รายละเอียดตามไปอ่านต้นฉบับนะ"',
  '4) ข่าวเศร้า/เสียชีวิต/เหตุรุนแรง ให้เล่าสุภาพ ไม่เล่นมุก',
  '5) ตอบเป็นข้อความธรรมดา ไม่ใช้สัญลักษณ์ markdown'
].join('\n');

// ---------- API ----------
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!key || body.k !== key) return out_({ ok: false, error: 'รหัสไม่ถูกต้อง' });
    const fn = String(body.fn || '');
    if (!fn || fn.slice(-1) === '_' || typeof API[fn] !== 'function') {
      return out_({ ok: false, error: 'ไม่มีคำสั่งนี้' });
    }
    return out_({ ok: true, result: API[fn].apply(null, body.args || []) });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return out_({ ok: true, result: 'song-khao api' });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const API = {
  ping: function () { return 'pong'; },
  list: list,
  ingest: ingest,
  retellPending: retellPending,
  translatePending: translatePending,
  retell: retell,
  chat: chat
};

// ใช้ครั้งเดียวในหน้า Apps Script: ขอสิทธิ์ + สร้างชีต
function authorize() {
  sheet_();
  UrlFetchApp.fetch('https://news.google.com/rss', { muteHttpExceptions: true });
  Logger.log('ok');
}

// ---------- ชีต ----------
function sheet_() {
  const p = PropertiesService.getScriptProperties();
  let id = p.getProperty('SHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('ส่งข่าว');
    p.setProperty('SHEET_ID', ss.getId());
  }
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, HEAD.length).getValue() !== HEAD[HEAD.length - 1]) {
    // เพิ่มคอลัมน์ใหม่ให้ชีตเดิม
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  }
  return sh;
}

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const vals = sh.getRange(2, 1, n, HEAD.length).getValues();
  return vals.map(function (r, i) {
    const o = { _row: i + 2 };
    HEAD.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function pub_(o) {
  return {
    id: o.id, region: o.region, title: o.title, source: o.source, url: o.url,
    metric: o.metric, score: Number(o.score) || 0, ts: Number(o.ts) || 0,
    lung: o.lung || '', tag: o.tag || '', title_th: o.title_th || ''
  };
}

// ---------- อ่าน ----------
function list(region, limit) {
  const sh = sheet_();
  const lim = Math.min(Number(limit) || 40, 80);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const all = rows_(sh).filter(function (o) {
    return (!region || o.region === region) && Number(o.ts) >= since && o.title;
  });
  all.sort(function (a, b) { return Number(b.score) - Number(a.score); });
  return all.slice(0, lim).map(pub_);
}

// ---------- เขียน (ตัวดึงข่าวเรียก) ----------
// items: [{id, region, title, source, url, metric, score, snippet, tag}]
function ingest(items) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_();
    const cur = rows_(sh);
    const byId = {};
    cur.forEach(function (o) { byId[o.id] = o; });
    const now = Date.now();
    const add = [];
    let upd = 0;
    (items || []).forEach(function (it) {
      if (!it || !it.id || !it.title) return;
      const ex = byId[it.id];
      if (ex) {
        // อัปเดตคะแนน/ตัวชี้วัดของข่าวเดิม
        sh.getRange(ex._row, 6, 1, 3).setValues([[it.metric || ex.metric, Number(it.score) || 0, now]]);
        upd++;
      } else {
        add.push([it.id, it.region, it.title, it.source || '', it.url || '', it.metric || '',
          Number(it.score) || 0, now, String(it.snippet || '').slice(0, 600), '', it.tag || '', '']);
        byId[it.id] = { _row: -1 };
      }
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, HEAD.length).setValues(add);
    prune_(sh);
    return { added: add.length, updated: upd };
  } finally {
    lock.releaseLock();
  }
}

function prune_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const ts = sh.getRange(2, 8, n, 1).getValues();
  const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const del = [];
  ts.forEach(function (r, i) { if (Number(r[0]) < limit) del.push(i + 2); });
  // ลบจากล่างขึ้นบน
  del.reverse().forEach(function (r) { sh.deleteRow(r); });
  const left = sh.getLastRow() - 1;
  if (left > MAX_ROWS) sh.deleteRows(2, left - MAX_ROWS);
}

// ---------- แปลหัวข้อข่าวโลกเป็นไทย (ครั้งเดียวหลายหัวข้อ) ----------
function translatePending(limit) {
  const sh = sheet_();
  const lim = Math.min(Number(limit) || 20, 30);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const todo = rows_(sh).filter(function (o) {
    return o.region === 'world' && o.title && !o.title_th && Number(o.ts) >= since;
  });
  todo.sort(function (a, b) { return Number(b.score) - Number(a.score); });
  const batch = todo.slice(0, lim);
  if (!batch.length) return { done: 0, left: 0 };
  const sys = 'คุณเป็นบรรณาธิการข่าว แปลหัวข้อข่าวภาษาอังกฤษเป็นภาษาไทยให้อ่านลื่นแบบพาดหัวข่าว ' +
    'แปลตรงตามต้นฉบับ ห้ามเติมความเห็นหรือรายละเอียดที่ไม่มี ชื่อคน/องค์กรใช้ตามที่คนไทยนิยมเรียก ถ้าไม่แน่ใจให้คงชื่อเป็นอังกฤษ ' +
    'ตอบเป็น JSON array ของสตริงเท่านั้น จำนวนและลำดับตรงกับที่ให้';
  const prompt = JSON.stringify(batch.map(function (o) { return o.title; }));
  const txt = gemini_(sys, [{ role: 'user', parts: [{ text: prompt }] }], 0.2, true);
  const arr = JSON.parse(txt);
  if (!Array.isArray(arr) || arr.length !== batch.length) throw new Error('แปลไม่ครบ ลองใหม่');
  let done = 0;
  batch.forEach(function (o, i) {
    const t = String(arr[i] || '').trim();
    if (t) { sh.getRange(o._row, 12).setValue(t); done++; }
  });
  return { done: done, left: Math.max(todo.length - done, 0) };
}

// ---------- ลุงเล่า ----------
function retellPending(limit) {
  const sh = sheet_();
  const lim = Math.min(Number(limit) || 6, 10);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const todo = rows_(sh).filter(function (o) {
    return !o.lung && o.title && Number(o.ts) >= since;
  });
  todo.sort(function (a, b) { return Number(b.score) - Number(a.score); });
  let done = 0, failed = 0;
  todo.slice(0, lim).forEach(function (o) {
    try {
      sh.getRange(o._row, 10).setValue(retellText_(o));
      done++;
    } catch (e) {
      failed++;
    }
  });
  return { done: done, failed: failed, left: Math.max(todo.length - done, 0) };
}

function retell(id) {
  const sh = sheet_();
  const o = rows_(sh).filter(function (x) { return x.id === id; })[0];
  if (!o) throw new Error('ไม่พบข่าวนี้ (อาจถูกลบแล้ว)');
  if (o.lung) return o.lung;
  const t = retellText_(o);
  sh.getRange(o._row, 10).setValue(t);
  return t;
}

function newsInfo_(o) {
  return 'หัวข้อ: ' + o.title +
    (o.snippet ? '\nสรุป/ข้อมูลเพิ่ม: ' + o.snippet : '') +
    '\nแหล่ง: ' + (o.source || 'ไม่ระบุ') +
    (o.metric ? '\nความร้อนแรง: ' + o.metric : '');
}

function retellText_(o) {
  const prompt = 'เล่าข่าวนี้ใหม่ในสำนวนลุง ความยาว 3–5 ประโยค ปิดท้ายด้วยประโยคเดียวที่ชวนให้คนอ่านอยากแสดงความเห็น\n\n' + newsInfo_(o);
  return gemini_(LUNG, [{ role: 'user', parts: [{ text: prompt }] }], 0.8);
}

// ---------- แชท ----------
// hist: [{r:'u'|'a', t:'...'}], heads: หัวข้อข่าวในหน้าแอป (ข้อความสั้น ๆ)
function chat(id, text, hist, heads) {
  const msg = String(text || '').trim();
  if (!msg) throw new Error('พิมพ์อะไรหน่อยสิ');
  let ctx = '';
  if (id) {
    const o = rows_(sheet_()).filter(function (x) { return x.id === id; })[0];
    if (o) ctx += 'ข่าวที่กำลังคุยกัน:\n' + newsInfo_(o) + (o.lung ? '\nที่ลุงเล่าไปแล้ว: ' + o.lung : '') + '\n\n';
  }
  if (heads && heads.length) {
    ctx += 'หัวข้อข่าวที่แสดงในแอปตอนนี้:\n- ' + heads.slice(0, 15).map(function (h) { return String(h).slice(0, 120); }).join('\n- ') + '\n\n';
  }
  const sys = LUNG + '\n\nตอนนี้เป็นโหมดคุยแชท ตอบคำถามให้ตรงประเด็น กระชับ (ไม่เกิน 6 ประโยคเว้นแต่ถูกขอยาว) ' +
    'ใช้ข้อมูลในบริบทที่ให้เท่านั้นสำหรับข้อเท็จจริงของข่าว ถ้าไม่มีให้บอกว่าลุงไม่แน่ใจ ห้ามแต่ง ' +
    'ถ้าถูกขอไอเดียทำคอนเทนต์ (แคปชั่น มุมเล่า หัวข้อคลิป) ให้ช่วยเต็มที่ แต่ยึดข้อเท็จจริงในบริบท\n\n' + ctx;
  const contents = [];
  (hist || []).slice(-8).forEach(function (h) {
    contents.push({ role: h.r === 'a' ? 'model' : 'user', parts: [{ text: String(h.t || '').slice(0, 1500) }] });
  });
  contents.push({ role: 'user', parts: [{ text: msg.slice(0, 1500) }] });
  return gemini_(sys, contents, 0.9);
}

// ---------- Gemini ----------
function gemini_(system, contents, temp, asJson) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) throw new Error('ยังไม่ได้ตั้ง GEMINI_KEY');
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: contents,
    generationConfig: { temperature: temp, thinkingConfig: { thinkingLevel: 'minimal' } }
  };
  if (asJson) payload.generationConfig.responseMimeType = 'application/json';
  for (let m = 0; m < MODELS.length; m++) {
    for (let t = 0; t < 2; t++) {
      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + MODELS[m] + ':generateContent',
        {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { 'x-goog-api-key': key }, payload: JSON.stringify(payload)
        });
      const code = res.getResponseCode();
      if (code === 200) {
        const j = JSON.parse(res.getContentText());
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const txt = parts.map(function (p) { return p.text || ''; }).join('').trim();
        if (txt) return txt;
      }
      if (code === 400 || code === 401 || code === 403) {
        throw new Error('Gemini ปฏิเสธคำขอ (เช็ก GEMINI_KEY)');
      }
      Utilities.sleep(1500 + Math.floor(Math.random() * 1000));
    }
  }
  throw new Error('Gemini ไม่ว่าง (คนใช้เยอะ) รอสักครู่แล้วกดส่งใหม่');
}
