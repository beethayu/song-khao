/**
 * ส่งข่าว — หลังบ้าน Apps Script
 * POST text/plain {fn, args, k} -> {ok, result} | {ok:false, error}
 * Script Properties: API_KEY, GEMINI_KEY, SHEET_ID (สร้างเอง)
 */

const SHEET_NAME = 'news';
const HEAD = ['id', 'region', 'title', 'source', 'url', 'metric', 'score', 'ts', 'snippet', 'lung', 'tag', 'title_th', 'drama', 'sides', 'mood', 'facts'];
const LUNG_VER = '3'; // เปลี่ยนเลขนี้ = ล้างสำนวนลุงเก่าทั้งหมดแล้วเล่าใหม่
const KEEP_DAYS = 4;
const MAX_ROWS = 600;
const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

const LUNG = [
  'คุณคือ "ลุง" ผู้ชายวัยกลางคนค่อนไปทางสูงวัย คนเล่าข่าวสำนวนบ้าน ๆ พูดตรง ๆ ห้วน ๆ มีอารมณ์ขันแบบแซวหน้านิ่ง ไม่หวาน ไม่เว่อร์ แทนตัวเองว่า "ลุง" เรียกคนอ่านว่า "หลาน" (ใช้พอประมาณ ไม่ต้องทุกประโยค)',
  'น้ำเสียง: เหมือนลุงนั่งจิบกาแฟหน้าบ้านเล่าข่าวให้ฟัง ใช้คำแนว "เอ้า" "เฮ้อ" "ลุงว่านะ" "เรื่องมันมีอยู่ว่า" "ก็ว่ากันไป" ลงท้ายแบบผู้ชาย (นะ แหละ เนี่ย)',
  'ห้ามน้ำเสียงป้า/แอดมินเพจบันเทิง: ห้ามใช้ "อุ๊ย" "ต๊ายตาย" "กรี๊ด" "แซ่บ" "ปัง" "เม้นท์" "จ้า" "ค่ะ" "คะ" "ซิ/ทีซิ" ห้ามใช้ emoji และคำแสลงวัยรุ่น',
  'กติกาเหล็ก:',
  '1) เล่าเฉพาะข้อเท็จจริงที่ได้รับในหัวข้อ/สรุป/ข่าวย่อเท่านั้น ห้ามแต่งรายละเอียด ตัวเลข คำพูด หรือเหตุการณ์เพิ่ม',
  '2) เรื่องของคนจริง/คดี/อุบัติเหตุ ให้ใช้ "ตามข่าวว่า…" ห้ามตัดสิน กล่าวหา หรือซ้ำเติมใคร',
  '3) ถ้าข้อมูลมีแค่หัวข้อสั้น ๆ ให้เล่าสั้น แล้วบอกตรง ๆ ว่า "ลุงรู้แค่นี้ รายละเอียดตามไปอ่านต้นฉบับนะ"',
  '4) ข่าวเศร้า/เสียชีวิต/เหตุรุนแรง ให้เล่าสุภาพ ไม่เล่นมุก',
  '5) ตอบเป็นข้อความธรรมดา ไม่ใช้สัญลักษณ์ markdown',
  '6) เวลาจิกกัด จิกได้เฉพาะ "สถานการณ์/พฤติกรรม/ระบบ" ห้ามด่าตัวบุคคล ห้ามคำหยาบ ห้ามล้อรูปร่าง เพศ ศาสนา เชื้อชาติ ความพิการ',
  '7) ห้ามแตะหรือเล่นมุกเกี่ยวกับสถาบันพระมหากษัตริย์',
  '8) เรื่องคดี/ข้อกล่าวหา: ข้อเท็จจริงที่ยืนยันแล้ว (ถูกจับ ถูกแจ้งข้อหา ศาลมีคำสั่ง) เล่าตรง ๆ ได้ แต่ถ้ายังไม่มีคำพิพากษา การถูกจับ/ถูกแจ้งข้อหาไม่เท่ากับผิดจริง ' +
    'ห้ามพูดว่าเขาผิด/โกง/ทำจริงเป็นข้อเท็จจริง ให้ใช้คำว่า "ผู้ต้องหา" "ถูกกล่าวหาว่า" "ตามที่ตำรวจแจ้ง" ถ้าศาลตัดสินแล้วจึงเล่าตามคำพิพากษาได้ ' +
    'และจิกที่ปฏิกิริยาสังคมหรือสถานการณ์ ไม่จิกตัวผู้ต้องหา'
].join('\n');

const FACTS_PROMPT = [
  'คุณเป็นผู้ช่วยกองบรรณาธิการ อ่านเนื้อข่าวที่ให้ แล้วเขียน "ข่าวย่อ" ภาษาไทยจากเนื้อหานั้นเท่านั้น',
  'รูปแบบ: 5–8 บรรทัดสั้น ๆ แต่ละบรรทัดขึ้นต้นด้วย "• " ครอบคลุม เกิดอะไรขึ้น / ใคร ที่ไหน เมื่อไหร่ / ตัวเลขสำคัญ / ความคืบหน้าล่าสุด / ประเด็นที่คนเถียงกัน',
  'บรรทัดสุดท้ายเขียนว่า "ที่มา: " ตามด้วยชื่อแหล่งข่าวที่ให้ไว้',
  'กติกา: เรียบเรียงใหม่ด้วยคำของคุณเอง ห้ามคัดลอกประโยคยาวจากข่าว (ยกคำพูดได้ไม่เกิน 15 คำ) ห้ามเดา ห้ามเติมสิ่งที่ไม่พบ',
  'เรื่องคดี: ถ้ายังไม่มีคำพิพากษา ให้ใช้ "ผู้ต้องหา" "ถูกกล่าวหาว่า" "ตำรวจแจ้งข้อหา…" ห้ามระบุว่าผิดจริง',
  'ถ้าเนื้อหาไม่ใช่ข่าวหรืออ่านไม่รู้เรื่อง ให้ตอบคำเดียวว่า "ไม่พบ"'
].join('\n');

const SCORE_PROMPT = [
  'คุณเป็นบรรณาธิการคอนเทนต์ดราม่าของเพจเล่าข่าวสไตล์ลุงจิกกัดขำ ๆ ให้คะแนนหัวข้อข่าวแต่ละข้อ',
  'd = คะแนน 0-10 ว่าเป็น "ดราม่าที่คนทั่วไปเข้าใจง่าย มีคู่กรณีหรือประเด็นให้เลือกข้างและคอมเมนต์เถียงกันได้"',
  '  สูง 7-10: พฤติกรรมคน ความไม่ยุติธรรม ร้านค้า/ผู้บริโภค ค่าครองชีพ ดราม่าโซเชียล ความเห็นขัดแย้งที่ชาวบ้านมีส่วนร่วม',
  '  กลาง 4-6: มีประเด็นแต่เถียงยาก',
  '  ต่ำ 0-2: ตัวเลขล้วน (เลขสลาก/ผลรางวัล) ราคาทอง/หุ้น/น้ำมัน สภาพอากาศ ผลกีฬา/บันเทิง ประกาศทางการ ข่าวเทคนิค/ธุรกิจเฉพาะทาง ข่าวที่ไม่มีคู่กรณีหรือประเด็นให้เถียง',
  '  เรื่องสถาบันพระมหากษัตริย์ ให้ d = 0',
  'sides = สองฝั่งที่คนน่าจะเถียงกัน ไม่เกิน 12 คำ รูปแบบ "ฝั่ง A / ฝั่ง B" (ถ้าไม่มีให้เป็นสตริงว่าง)',
  'mood = "jig" (จิกกัดขำ ๆ ได้) | "neutral" (การเมืองพรรค ศาสนา ประเด็นแบ่งขั้ว: เล่าเป็นกลาง) | "serious" (เสียชีวิต เหตุรุนแรง เด็ก เหยื่อ อุบัติเหตุ ภัยพิบัติ: เล่าสุภาพ ห้ามเล่นมุก)',
  'ตอบเป็น JSON array ของ object {"d":number,"sides":string,"mood":string} จำนวนและลำดับตรงกับหัวข้อที่ให้'
].join('\n');

function dr_(o) { return (o.drama === '' || o.drama == null) ? null : Number(o.drama); }
function rank_(o) { const d = dr_(o); return (d === null ? 4 : d) * 12 + (Number(o.score) || 0); }

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
  scorePending: scorePending,
  needFacts: needFacts,
  factsFromText: factsFromText,
  retell: retell,
  makePost: makePost,
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
    lung: o.lung || '', tag: o.tag || '', title_th: o.title_th || '',
    drama: dr_(o), sides: o.sides || '', mood: o.mood || '',
    facts: (o.facts && o.facts !== '-') ? String(o.facts) : ''
  };
}

// ---------- อ่าน ----------
function list(region, limit) {
  const sh = sheet_();
  const lim = Math.min(Number(limit) || 40, 80);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const all = rows_(sh).filter(function (o) {
    const d = dr_(o);
    return (!region || o.region === region) && Number(o.ts) >= since && o.title && (d === null || d >= 3);
  });
  all.sort(function (a, b) { return rank_(b) - rank_(a); });
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
          Number(it.score) || 0, now, String(it.snippet || '').slice(0, 600), '', it.tag || '', '', '', '', '', '']);
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

// ---------- ให้คะแนนความดราม่า + หาสองฝั่งที่คนจะเถียง ----------
function scorePending(limit) {
  const sh = sheet_();
  const lim = Math.min(Number(limit) || 25, 30);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const todo = rows_(sh).filter(function (o) {
    return o.title && dr_(o) === null && Number(o.ts) >= since;
  });
  todo.sort(function (a, b) { return Number(b.score) - Number(a.score); });
  const batch = todo.slice(0, lim);
  if (!batch.length) return { done: 0, left: 0 };
  const prompt = JSON.stringify(batch.map(function (o) { return o.title_th || o.title; }));
  const arr = JSON.parse(gemini_(SCORE_PROMPT, [{ role: 'user', parts: [{ text: prompt }] }], 0.2, true));
  if (!Array.isArray(arr) || arr.length !== batch.length) throw new Error('ให้คะแนนไม่ครบ ลองใหม่');
  let done = 0;
  batch.forEach(function (o, i) {
    const r = arr[i] || {};
    const d = Math.max(0, Math.min(10, Math.round(Number(r.d))));
    if (isNaN(d)) return;
    const mood = ['jig', 'neutral', 'serious'].indexOf(r.mood) >= 0 ? r.mood : 'neutral';
    sh.getRange(o._row, 13, 1, 3).setValues([[d, String(r.sides || '').slice(0, 80), mood]]);
    if (o.lung) sh.getRange(o._row, 10).setValue(''); // ล้างสำนวนเก่า ให้ลุงเล่าใหม่ตามสไตล์ใหม่
    done++;
  });
  return { done: done, left: Math.max(todo.length - done, 0) };
}

// ---------- ข่าวย่อ (ตัวดึงข่าวเปิดอ่านเนื้อข่าว แล้วส่งมาให้ Gemini สรุปด้วยคำของมัน) ----------
// ไม่เก็บเนื้อข่าวเต็ม เก็บเฉพาะข่าวย่อที่เรียบเรียงใหม่
function needFacts(limit) {
  const sh = sheet_();
  const lim = Math.min(Number(limit) || 12, 20);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const todo = rows_(sh).filter(function (o) {
    const d = dr_(o);
    return o.title && o.url && !o.facts && Number(o.ts) >= since && d !== null && d >= 5;
  });
  todo.sort(function (a, b) { return rank_(b) - rank_(a); });
  return todo.slice(0, lim).map(function (o) { return { id: o.id, url: o.url, title: o.title }; });
}

// text ว่าง = อ่านเนื้อข่าวไม่ได้ ใส่ "-" เพื่อไม่ต้องลองซ้ำ
function factsFromText(id, text) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_();
    const o = rows_(sh).filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false };
    const body = String(text || '').trim().slice(0, 7000);
    let out = '-';
    if (body.length >= 200) {
      const q = 'หัวข้อข่าว: ' + (o.title_th || o.title) + '\nแหล่งข่าว: ' + (o.source || 'ไม่ระบุ') + '\n\nเนื้อข่าว:\n' + body;
      const t = String(gemini_(FACTS_PROMPT, [{ role: 'user', parts: [{ text: q }] }], 0.2)).trim();
      if (t.length >= 25) out = t.slice(0, 1800);
    }
    sh.getRange(o._row, 16).setValue(out);
    return { ok: true, has: out !== '-' };
  } finally {
    lock.releaseLock();
  }
}

function migrateLung_(sh) {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('LUNG_VER') === LUNG_VER) return;
  const n = sh.getLastRow() - 1;
  if (n >= 1) sh.getRange(2, 10, n, 1).clearContent();
  p.setProperty('LUNG_VER', LUNG_VER);
}

// ---------- ลุงเล่า ----------
function retellPending(limit) {
  const sh = sheet_();
  migrateLung_(sh);
  const lim = Math.min(Number(limit) || 6, 10);
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const todo = rows_(sh).filter(function (o) {
    const d = dr_(o);
    return !o.lung && o.title && Number(o.ts) >= since && (d === null || d >= 5);
  });
  // ข่าวที่มีข่าวย่อแล้วเล่าก่อน (ข้อมูลครบกว่า)
  todo.sort(function (a, b) {
    const fa = (a.facts && a.facts !== '-') ? 1 : 0, fb = (b.facts && b.facts !== '-') ? 1 : 0;
    return fb - fa || rank_(b) - rank_(a);
  });
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
  return 'หัวข้อ: ' + o.title + (o.title_th ? '\nแปลไทย: ' + o.title_th : '') +
    (o.snippet ? '\nสรุป/ข้อมูลเพิ่ม: ' + o.snippet : '') +
    (o.facts && o.facts !== '-' ? '\nข่าวย่อ (สรุปจากแหล่งข่าว):\n' + o.facts : '') +
    '\nแหล่ง: ' + (o.source || 'ไม่ระบุ') +
    (o.metric ? '\nความร้อนแรง: ' + o.metric : '');
}

function retellText_(o) {
  const mood = o.mood || 'jig';
  let how;
  if (mood === 'serious') {
    how = 'ข่าวนี้อ่อนไหว เล่าสุภาพ เห็นใจ ห้ามเล่นมุกหรือจิกกัด 3–4 ประโยค ปิดท้ายด้วยประโยคห่วงใยหรือเตือนใจ ไม่ต้องถามให้เลือกข้าง';
  } else if (mood === 'neutral') {
    how = 'ข่าวนี้อ่อนไหว (การเมือง/ศาสนา/ประเด็นแบ่งขั้ว) เล่าเป็นกลาง ไม่เข้าข้างและไม่จิกฝ่ายใดเป็นพิเศษ 3–4 ประโยค ปิดท้ายถามความเห็นแบบเปิด ไม่ชี้นำ';
  } else {
    how = 'เล่าแบบจิก ๆ ขำ ๆ 4–6 ประโยค: เปิดด้วยประโยคสะดุดหู เล่าข้อเท็จจริงสั้น ๆ แล้วจิกกัดที่ตัวสถานการณ์/พฤติกรรม/ระบบ ' +
      'ปิดท้ายแบบลุงด้วยคำถามให้คนเลือกข้างในคอมเมนต์ 1 ประโยค เช่น "หลานอยู่ทีมไหน เขียนมาบอกลุงหน่อย"' +
      (o.sides ? '\nฝั่งที่คนน่าจะเถียงกัน: ' + o.sides : '');
  }
  const prompt = 'เล่าข่าวนี้ใหม่ในสำนวนลุง ' + how + '\n\n' + newsInfo_(o);
  return gemini_(LUNG, [{ role: 'user', parts: [{ text: prompt }] }], 0.8);
}

// ---------- สร้างโพสต์ ----------
function makePost(id) {
  const o = rows_(sheet_()).filter(function (x) { return x.id === id; })[0];
  if (!o) throw new Error('ไม่พบข่าวนี้ (อาจถูกลบแล้ว)');
  const mood = o.mood || 'jig';
  const tone = mood === 'serious' ? 'ข่าวอ่อนไหว: น้ำเสียงสุภาพเห็นใจ ห้ามมุกหรือจิกกัด ไม่ต้องมีคำถามเลือกข้าง (q ให้เป็นประโยคชวนแสดงความรู้สึก/ห่วงใย)'
    : mood === 'neutral' ? 'ข่าวอ่อนไหว: เป็นกลาง ไม่เข้าข้าง q ให้เป็นคำถามเปิดไม่ชี้นำ'
    : 'จิก ๆ ขำ ๆ แบบลุง จิกที่สถานการณ์/ระบบ/พฤติกรรม ไม่จิกตัวบุคคล q ให้เป็นคำถามให้คนเลือกข้างในคอมเมนต์' + (o.sides ? ' (ฝั่ง: ' + o.sides + ')' : '');
  const prompt = 'ทำโพสต์ Facebook/X จากข่าวนี้ ตอบเป็น JSON เท่านั้น รูปแบบ {"hook":"","body":"","q":"","tags":["","","","",""]}\n' +
    '- hook: ประโยคเปิดสะดุดหู ไม่เกิน 60 ตัวอักษร (ใช้บนการ์ดภาพด้วย)\n' +
    '- body: เนื้อสั้นแบบลุง 2–3 ประโยค ยึดข้อเท็จจริงในข้อมูลเท่านั้น ห้ามแต่ง ข่าวคดีใช้ "ผู้ต้องหา/ถูกกล่าวหาว่า"\n' +
    '- q: คำถามปิดท้าย 1 ประโยค\n- tags: แฮชแท็กไทย 5 อัน ขึ้นต้นด้วย # ไม่มีเว้นวรรค\n' + tone + '\n\n' + newsInfo_(o) + (o.lung ? '\nที่ลุงเล่าไว้แล้ว: ' + o.lung : '');
  const raw = gemini_(LUNG, [{ role: 'user', parts: [{ text: prompt }] }], 0.8, true);
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('ลุงเรียบเรียงไม่สำเร็จ ลองกดใหม่'); }
  const tags = (j.tags || []).map(function (t) { t = String(t).replace(/\s+/g, ''); return t.charAt(0) === '#' ? t : '#' + t; }).slice(0, 5);
  return { hook: String(j.hook || '').slice(0, 90), body: String(j.body || ''), q: String(j.q || ''), tags: tags };
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
function gemini_(system, contents, temp, asJson, tools) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) throw new Error('ยังไม่ได้ตั้ง GEMINI_KEY');
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: contents,
    generationConfig: { temperature: temp, thinkingConfig: { thinkingLevel: 'minimal' } }
  };
  if (asJson) payload.generationConfig.responseMimeType = 'application/json';
  if (tools) payload.tools = tools;
  let last = '';
  for (let m = 0; m < MODELS.length; m++) {
    for (let t = 0; t < 2; t++) {
      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + MODELS[m] + ':generateContent',
        {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { 'x-goog-api-key': key }, payload: JSON.stringify(payload)
        });
      const code = res.getResponseCode();
      if (code !== 200) {
        let em = '';
        try { em = String(JSON.parse(res.getContentText()).error.message || '').slice(0, 90); } catch (e) { /* ignore */ }
        last = code + (em ? ' ' + em : '');
      }
      if (code === 200) {
        const j = JSON.parse(res.getContentText());
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const txt = parts.map(function (p) { return p.text || ''; }).join('').trim();
        if (txt) return txt;
      }
      if (code === 400 || code === 401 || code === 403) {
        let msg = '';
        try { msg = String(JSON.parse(res.getContentText()).error.message || '').slice(0, 100); } catch (e) { /* ignore */ }
        throw new Error('Gemini ปฏิเสธคำขอ ' + code + (msg ? ': ' + msg : ''));
      }
      Utilities.sleep(1500 + Math.floor(Math.random() * 1000));
    }
  }
  throw new Error('Gemini ไม่ว่าง' + (last ? ' [' + last + ']' : '') + ' รอสักครู่แล้วกดส่งใหม่');
}
