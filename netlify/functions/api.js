const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');

const LEVELS = {
  8:  { price:'8.8r',  limit:8,  min:150, max:300, blanks:[1,2], itemAllowed:[] },
  15: { price:'18.8r', limit:15, min:350, max:500, blanks:[2,4], itemAllowed:['sword','longzhou'] },
  25: { price:'28.8r', limit:25, min:650, max:800, blanks:[4,6], itemAllowed:['sword','longzhou'] }
};
const MONEY_VALUES = [5,10,15,30,50,80,100,150,200];
const TOTAL_BANDS = {
  '8': [
    { id:'100', label:'100多W', min:150, max:199 },
    { id:'200', label:'200多W', min:200, max:299 },
    { id:'300', label:'300W', min:300, max:300 }
  ],
  '15': [
    { id:'300', label:'300多W', min:350, max:399 },
    { id:'400', label:'400多W', min:400, max:499 },
    { id:'500', label:'500W', min:500, max:500 }
  ],
  '25': [
    { id:'600', label:'600多W', min:650, max:699 },
    { id:'700', label:'700多W', min:700, max:799 },
    { id:'800', label:'800W', min:800, max:800 }
  ]
};
const ITEM_NAMES = { sword:'大剑', longzhou:'龙舟送吉', wadang:'瓦当', tunjin:'吞金兽', cup:'圣杯' };
const DEFAULT_SETTINGS = {
  itemChance: { '8':0, '15':2, '25':4 },
  itemWeights: {
    '15':{ sword:100, longzhou:100 },
    '25':{ sword:100, longzhou:100 }
  },
  totalBandWeights: {
    '8': { '100':1, '200':1, '300':1 },
    '15': { '300':1, '400':1, '500':1 },
    '25': { '600':1, '700':1, '800':1 }
  },
  moneyWeights: {
    '8': Object.fromEntries(MONEY_VALUES.map(v=>[String(v),1])),
    '15': Object.fromEntries(MONEY_VALUES.map(v=>[String(v),1])),
    '25': Object.fromEntries(MONEY_VALUES.map(v=>[String(v),1]))
  }
};

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
function beijingTime(input = Date.now()) {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
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
  if (!out.totalBandWeights) {
    out.totalBandWeights = {
      '8': { '100':1, '200':1, '300':1 },
      '15': { '300':1, '400':1, '500':1 },
      '25': { '600':1, '700':1, '800':1 }
    };
  }
  if (s && s.totalBandWeights) {
    for (const level of ['8','15','25']) {
      if (!out.totalBandWeights[level]) out.totalBandWeights[level] = {};
      for (const band of TOTAL_BANDS[level]) {
        out.totalBandWeights[level][band.id] = clampWeight(s.totalBandWeights[level]?.[band.id], out.totalBandWeights[level][band.id] ?? 1);
      }
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
function weightedPickMoney(weights, candidates) {
  const entries = candidates.map(v => [v, Math.max(0, Number(weights[String(v)] || 0))]).filter(([,w]) => w > 0);
  if (!entries.length) return candidates[rnd(0, candidates.length - 1)];
  const total = entries.reduce((s, [,w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v,w] of entries) { r -= w; if (r <= 0) return v; }
  return entries[entries.length - 1][0];
}

function pickWeightedBand(level, settings) {
  const bands = TOTAL_BANDS[String(level)] || [];
  const weights = (settings && settings.totalBandWeights && settings.totalBandWeights[String(level)]) ? settings.totalBandWeights[String(level)] : {};
  const entries = bands.map(b => [b, Math.max(0, Number(weights[b.id] || 0))]).filter(([,w]) => w > 0);
  const usable = entries.length ? entries : bands.map(b => [b, 1]);
  const total = usable.reduce((s, [,w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [band,w] of usable) { r -= w; if (r <= 0) return band; }
  return usable[usable.length - 1][0];
}
function pickTotalForLevel(level, settings) {
  const band = pickWeightedBand(level, settings);
  const min = Math.ceil(band.min / 5) * 5;
  const max = Math.floor(band.max / 5) * 5;
  return rnd(min / 5, max / 5) * 5;
}
function buildValuesForTarget(target, count) {
  const values = [];
  let remaining = target;
  for (let i = 0; i < count; i++) {
    const left = count - i - 1;
    const candidates = MONEY_VALUES.filter(v => remaining - v >= left * 5 && remaining - v <= left * 200);
    const usable = candidates.length ? candidates : [5];
    const v = usable[rnd(0, usable.length - 1)];
    values.push(v);
    remaining -= v;
  }
  if (remaining !== 0 && values.length) values[values.length - 1] += remaining;
  return values;
}

function buildMoneyPrizes(level, settings) {
  const cfg = LEVELS[level];
  const blankCount = rnd(cfg.blanks[0], cfg.blanks[1]);
  const moneyCount = cfg.limit - blankCount;
  const targetTotal = pickTotalForLevel(level, settings);
  const values = buildValuesForTarget(targetTotal, moneyCount);
  const prizes = values.map(v => ({ type:'money', value:v }));
  const sequence = [...prizes, ...Array.from({length:blankCount}, () => ({type:'blank'}))];
  shuffle(sequence);
  return { mode:'money', totalExpected: values.reduce((a,b)=>a+Number(b||0),0), blankCount, item:null, sequence };
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
  return buildMoneyPrizes(level, settings);
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
    code, level, price: LEVELS[level].price, limit: LEVELS[level].limit,
    totalTickets, usedTickets:0, status:'unused',
    createdAt:new Date(now).toISOString(), createdAtBeijing:beijingTime(now),
    expiresAt:new Date(now + 7*24*60*60*1000).toISOString(),
    expiresAtBeijing:beijingTime(now + 7*24*60*60*1000)
  };
}
async function dbStore() {
  return getStore({ name:'koi-scratch-db' });
}
async function getDb() {
  const store = await dbStore();
  const raw = await store.get('db.json', { type:'json' });
  if (raw && typeof raw === 'object') {
    raw.codes = raw.codes || [];
    raw.redeems = raw.redeems || [];
    raw.settings = normalizeSettings(raw.settings || {});
    return raw;
  }
  return { codes:[], redeems:[], settings:clone(DEFAULT_SETTINGS) };
}
async function saveDb(db) {
  db.settings = normalizeSettings(db.settings || {});
  const store = await dbStore();
  await store.setJSON('db.json', db);
}
function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'Content-Type, Authorization',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}
function getPath(event) {
  let p = event.path || '';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.startsWith('/api/')) p = p.slice(4);
  return p;
}

exports.handler = async (event) => {
  try {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok:true });
    const path = getPath(event);
    const method = event.httpMethod;
    const body = event.body ? JSON.parse(event.body || '{}') : {};

    if (method === 'POST' && path === '/admin/login') return jsonResp(200, { token:'no-password' });

    if (method === 'GET' && path === '/admin/settings') {
      const db = await getDb();
      return jsonResp(200, { settings: normalizeSettings(db.settings || {}) });
    }

    if (method === 'POST' && path === '/admin/settings') {
      const db = await getDb();
      db.settings = normalizeSettings(body.settings || {});
      await saveDb(db);
      return jsonResp(200, { ok:true, settings:db.settings });
    }

    if (method === 'GET' && path === '/admin/codes') {
      const db = await getDb();
      return jsonResp(200, { codes: db.codes.slice().reverse().slice(0, 500) });
    }

    if (method === 'POST' && path === '/admin/codes') {
      const level = Number(body.level);
      const count = Math.max(1, Math.min(Number(body.count) || 1, 300));
      const uses = Math.max(1, Math.min(Number(body.uses) || 1, 999));
      if (!LEVELS[level]) return jsonResp(400, { error:'档位不正确' });
      const db = await getDb();
      const made = [];
      for (let i=0;i<count;i++) {
        let code;
        do { code = makeCode(); } while (db.codes.some(c => c.code === code));
        const rec = makeCodeRecord(code, level, uses);
        db.codes.push(rec);
        made.push(rec);
      }
      await saveDb(db);
      return jsonResp(200, { codes: made });
    }

    if (method === 'POST' && path === '/admin/codes/void') {
      const code = String(body.code || '').trim().toUpperCase();
      const db = await getDb();
      const rec = db.codes.find(c => c.code === code);
      if (!rec) return jsonResp(404, { error:'兑换码不存在' });
    rec.totalTickets = Math.max(1, Math.min(Number(rec.totalTickets) || 1, 999));
    rec.usedTickets = Math.max(0, Number(rec.usedTickets) || 0);
      rec.status = 'void';
      rec.voidedAt = new Date().toISOString();
      rec.voidedAtBeijing = beijingTime(rec.voidedAt);
      await saveDb(db);
      return jsonResp(200, { ok:true });
    }

    if (method === 'GET' && path === '/admin/redeems') {
      const db = await getDb();
      return jsonResp(200, { redeems: db.redeems.slice().reverse().slice(0, 300) });
    }

    if (method === 'POST' && path === '/redeem') {
      const code = String(body.code || '').trim().toUpperCase();
      const db = await getDb();
      const rec = db.codes.find(c => c.code === code);
      if (!rec) return jsonResp(404, { error:'兑换码不存在' });
      if (rec.status === 'void') return jsonResp(400, { error:'兑换码已作废' });
      rec.totalTickets = Math.max(1, Math.min(Number(rec.totalTickets) || 1, 999));
      rec.usedTickets = Math.max(0, Math.min(Number(rec.usedTickets) || 0, rec.totalTickets));
      if (new Date(rec.expiresAt).getTime() < Date.now()) {
        rec.status = 'expired';
        await saveDb(db);
        return jsonResp(400, { error:'兑换码已过期' });
      }
      if (rec.usedTickets >= rec.totalTickets) {
        rec.status = 'used';
        await saveDb(db);
        return jsonResp(400, { error:'兑换码已使用，不能继续刮奖' });
      }

      const settings = normalizeSettings(db.settings || {});
      const draw = generateSequence(rec.level, settings);
      rec.usedTickets += 1;
      rec.status = rec.usedTickets >= rec.totalTickets ? 'used' : 'partial';
      rec.usedAt = new Date().toISOString();
      rec.usedAtBeijing = beijingTime(rec.usedAt);

      const redeemedAt = new Date().toISOString();
      const itemName = draw.item ? ITEM_NAMES[draw.item] || draw.item : '';
      const redeem = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
        code:rec.code, level:rec.level, price:rec.price, limit:rec.limit,
        mode:draw.mode, totalExpected:draw.totalExpected, blankCount:draw.blankCount,
        item:draw.item, itemName,
        summary: draw.mode === 'item' ? `大金奖励：${itemName}；其余全部空白` : `金额奖励：${draw.totalExpected}W；空白${draw.blankCount}格`,
        sequence:draw.sequence,
        redeemedAt,
        redeemedAtBeijing:beijingTime(redeemedAt)
      };
      db.redeems.push(redeem);
      await saveDb(db);

      return jsonResp(200, {
        ok:true, redeemId:redeem.id, code:rec.code, level:rec.level, price:rec.price,
        limit:rec.limit, sequence:draw.sequence, item:draw.item, itemName, mode:draw.mode, redeemedAtBeijing:redeem.redeemedAtBeijing,
        remainingTickets:Math.max(0, rec.totalTickets - rec.usedTickets),
        totalTickets:rec.totalTickets, usedTickets:rec.usedTickets, expiresAt:rec.expiresAt
      });
    }

    return jsonResp(404, { error:'接口不存在', path });
  } catch (err) {
    return jsonResp(500, { error:err.message || '服务器错误' });
  }
};
