const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const LEVELS = {
  8:  { price:'8.8r',  limit:8,  min:150, max:300, blanks:[1,2], itemAllowed:[] },
  15: { price:'18.8r', limit:15, min:350, max:500, blanks:[2,4], itemAllowed:['sword','longzhou'] },
  25: { price:'28.8r', limit:25, min:650, max:800, blanks:[4,6], itemAllowed:['sword','longzhou'] }
};
const MONEY_VALUES = [5,10,15,30,50,80,100,150,200];
const ITEM_NAMES = { sword:'大剑', longzhou:'龙舟送吉', cup:'圣杯' };
const DEFAULT_SETTINGS = {
  itemChance: { '8':0, '15':20, '25':20 },
  itemWeights: {
    '15':{ sword:100, longzhou:100 },
    '25':{ sword:100, longzhou:100 }
  },
  moneyWeights: Object.fromEntries(MONEY_VALUES.map(v=>[String(v),1]))
};

function clone(o){ return JSON.parse(JSON.stringify(o)); }
function ensureDb(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      codes:[
        makeCodeRecord('TEST188',15,5),
        makeCodeRecord('TEST288',25,5)
      ],
      redeems:[],
      settings:clone(DEFAULT_SETTINGS)
    }, null, 2), 'utf8');
  }
}
function readDb(){
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  db.codes = db.codes || [];
  db.redeems = db.redeems || [];
  db.settings = normalizeSettings(db.settings || {});
  return db;
}
function saveDb(db){
  db.settings = normalizeSettings(db.settings || {});
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}
function beijingTime(input = Date.now()) {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12:false
  }).format(d).replace(/\//g, '-');
}
function clampWeight(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(999, n));
}
function normalizeSettings(s) {
  const out = clone(DEFAULT_SETTINGS);
  if (s && s.itemChance) {
    for (const k of ['8','15','25']) {
      const v = Number(s.itemChance[k]);
      if (Number.isFinite(v)) out.itemChance[k] = Math.max(0, Math.min(100, v));
    }
  }
  if (s && s.itemWeights) {
    for (const level of ['15','25']) {
      out.itemWeights[level].sword = clampWeight(s.itemWeights[level]?.sword, out.itemWeights[level].sword);
      out.itemWeights[level].longzhou = clampWeight(s.itemWeights[level]?.longzhou, out.itemWeights[level].longzhou);
    }
  }
  return out;
}
function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function weightedPick(weights, allowed) {
  const entries = allowed.map(k => [k, Math.max(0, Number(weights[k] || 0))]).filter(([,w]) => w > 0);
  if (!entries.length) return allowed[0];
  const total = entries.reduce((s, [,w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k,w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}
function buildMoneyPrizes(level) {
  const cfg = LEVELS[level];
  const blankCount = rnd(cfg.blanks[0], cfg.blanks[1]);
  const moneyCount = cfg.limit - blankCount;
  let remaining = rnd(cfg.min, cfg.max);
  const prizes = [];
  for (let i=0; i<moneyCount; i++) {
    const left = moneyCount - i - 1;
    let candidates = MONEY_VALUES.filter(v => v <= remaining - left * 5);
    if (!candidates.length) candidates = [5];
    let v = candidates[rnd(0, candidates.length - 1)];
    prizes.push({ type:'money', value:v });
    remaining -= v;
  }
  if (remaining > 0 && prizes.length) prizes[prizes.length - 1].value += remaining;
  const sequence = [...prizes, ...Array.from({length:blankCount}, () => ({type:'blank'}))];
  shuffle(sequence);
  return { mode:'money', totalExpected: prizes.reduce((s,p)=>s+Number(p.value||0),0), blankCount, item:null, sequence };
}
function generateSequence(level, settings) {
  const cfg = LEVELS[level];
  const allowed = cfg.itemAllowed || [];
  const chance = Number(settings.itemChance[String(level)] || 0);
  const itemMode = allowed.length && Math.random() * 100 < chance;
  if (itemMode) {
    const item = weightedPick(settings.itemWeights[String(level)] || {}, allowed);
    const sequence = [{ type:item }, ...Array.from({length: cfg.limit - 1}, () => ({type:'blank'}))];
    shuffle(sequence);
    return { mode:'item', totalExpected:0, blankCount:cfg.limit - 1, item, sequence };
  }
  return buildMoneyPrizes(level);
}
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'KOI';
  for (let i = 0; i < 9; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function makeCodeRecord(code, level, uses = 1) {
  const now = Date.now();
  const totalTickets = Math.max(1, Math.min(Number(uses) || 1, 999));
  return {
    code,
    level,
    price: LEVELS[level].price,
    limit: LEVELS[level].limit,
    totalTickets,
    usedTickets: 0,
    status: 'unused',
    createdAt: new Date(now).toISOString(),
    createdAtBeijing: beijingTime(now),
    expiresAt: new Date(now + 7*24*60*60*1000).toISOString(),
    expiresAtBeijing: beijingTime(now + 7*24*60*60*1000)
  };
}
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
  });
  res.end(payload);
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}
function serveStatic(req, res) {
  let reqPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (reqPath === '/' || reqPath === '/client') reqPath = '/client.html';
  if (reqPath === '/admin') reqPath = '/admin.html';
  const filePath = path.normalize(path.join(PUBLIC, reqPath));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html':'text/html; charset=utf-8',
    '.js':'application/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.png':'image/png',
    '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg',
    '.webp':'image/webp',
    '.svg':'image/svg+xml'
  };
  res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control':'no-cache'});
  fs.createReadStream(filePath).pipe(res);
}
async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathName = url.pathname.replace(/^\/api/, '') || '/';
  if (req.method === 'OPTIONS') return sendJson(res, 200, {ok:true});
  const body = await readBody(req);

  if (req.method === 'POST' && pathName === '/admin/login') return sendJson(res, 200, { token:'no-password' });

  if (req.method === 'GET' && pathName === '/admin/settings') {
    const db = readDb();
    return sendJson(res, 200, { settings: db.settings });
  }

  if (req.method === 'POST' && pathName === '/admin/settings') {
    const db = readDb();
    db.settings = normalizeSettings(body.settings || {});
    saveDb(db);
    return sendJson(res, 200, { ok:true, settings:db.settings });
  }

  if (req.method === 'GET' && pathName === '/admin/codes') {
    const db = readDb();
    return sendJson(res, 200, { codes: db.codes.slice().reverse().slice(0,500) });
  }

  if (req.method === 'POST' && pathName === '/admin/codes') {
    const level = Number(body.level);
    const count = Math.max(1, Math.min(Number(body.count) || 1, 300));
    const uses = Math.max(1, Math.min(Number(body.uses) || 1, 999));
    if (!LEVELS[level]) return sendJson(res, 400, { error:'档位不正确' });
    const db = readDb();
    const made = [];
    for (let i=0; i<count; i++) {
      let code;
      do { code = makeCode(); } while (db.codes.some(c => c.code === code));
      const rec = makeCodeRecord(code, level, uses);
      db.codes.push(rec);
      made.push(rec);
    }
    saveDb(db);
    return sendJson(res, 200, { codes: made });
  }

  if (req.method === 'POST' && pathName === '/admin/codes/void') {
    const code = String(body.code || '').trim().toUpperCase();
    const db = readDb();
    const rec = db.codes.find(c => c.code === code);
    if (!rec) return sendJson(res, 404, { error:'兑换码不存在' });
    rec.status = 'void';
    rec.voidedAt = new Date().toISOString();
    rec.voidedAtBeijing = beijingTime(rec.voidedAt);
    saveDb(db);
    return sendJson(res, 200, { ok:true });
  }

  if (req.method === 'GET' && pathName === '/admin/redeems') {
    const db = readDb();
    return sendJson(res, 200, { redeems: db.redeems.slice().reverse().slice(0,300) });
  }

  if (req.method === 'POST' && pathName === '/redeem') {
    const code = String(body.code || '').trim().toUpperCase();
    const db = readDb();
    const rec = db.codes.find(c => c.code === code);
    if (!rec) return sendJson(res, 404, { error:'兑换码不存在' });
    if (rec.status === 'void') return sendJson(res, 400, { error:'兑换码已作废' });
    if (new Date(rec.expiresAt).getTime() < Date.now()) {
      rec.status = 'expired';
      saveDb(db);
      return sendJson(res, 400, { error:'兑换码已过期' });
    }
    if (rec.usedTickets >= rec.totalTickets) {
      rec.status = 'used';
      saveDb(db);
      return sendJson(res, 400, { error:'兑换码已使用，不能继续刮奖' });
    }

    const draw = generateSequence(rec.level, normalizeSettings(db.settings || {}));
    rec.usedTickets += 1;
    rec.status = rec.usedTickets >= rec.totalTickets ? 'used' : 'partial';
    rec.usedAt = new Date().toISOString();
    rec.usedAtBeijing = beijingTime(rec.usedAt);

    const redeemedAt = new Date().toISOString();
    const itemName = draw.item ? ITEM_NAMES[draw.item] || draw.item : '';
    const redeem = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      code:rec.code,
      level:rec.level,
      price:rec.price,
      limit:rec.limit,
      mode:draw.mode,
      totalExpected:draw.totalExpected,
      blankCount:draw.blankCount,
      item:draw.item,
      itemName,
      summary: draw.mode === 'item' ? `大金奖励：${itemName}；其余全部空白` : `金额奖励：${draw.totalExpected}W；空白${draw.blankCount}格`,
      sequence:draw.sequence,
      redeemedAt,
      redeemedAtBeijing:beijingTime(redeemedAt)
    };
    db.redeems.push(redeem);
    saveDb(db);

    return sendJson(res, 200, {
      ok:true,
      redeemId:redeem.id,
      code:rec.code,
      level:rec.level,
      price:rec.price,
      limit:rec.limit,
      mode:draw.mode,
      item:draw.item,
      itemName,
      sequence:draw.sequence,
      redeemedAtBeijing:redeem.redeemedAtBeijing,
      remainingTickets:Math.max(0, rec.totalTickets - rec.usedTickets),
      totalTickets:rec.totalTickets,
      usedTickets:rec.usedTickets,
      expiresAt:rec.expiresAt
    });
  }

  return sendJson(res, 404, { error:'接口不存在' });
}

ensureDb();

const server = http.createServer(async (req, res) => {
  try {
    if (new URL(req.url, 'http://localhost').pathname.startsWith('/api')) {
      await handleApi(req, res);
    } else {
      serveStatic(req, res);
    }
  } catch (e) {
    sendJson(res, 500, { error:e.message || '服务器错误' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Koi Club 本地测试服务已启动');
  console.log(`客户页面：http://localhost:${PORT}/`);
  console.log(`后台页面：http://localhost:${PORT}/admin`);
  console.log('手机测试：手机和电脑同一 Wi-Fi，用电脑 IPv4 访问，例如 http://192.168.1.184:8787/');
  console.log('内置测试码：TEST188 / TEST288，每个可刮 5 张');
});
