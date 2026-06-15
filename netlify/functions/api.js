const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');

const LEVELS = {
  8:  { price:'8.8r',  limit:8,  min:150, max:300, blanks:[1,2], itemAllowed:[] },
  15: { price:'18.8r', limit:15, min:350, max:500, blanks:[2,4], itemAllowed:['wadang'] },
  25: { price:'28.8r', limit:25, min:650, max:800, blanks:[4,6], itemAllowed:['wadang','sword','tunjin'] }
};
const MONEY_VALUES = [5,10,15,30,50,80,100,150,200];
const ITEM_NAMES = { wadang:'瓦当', sword:'大剑', tunjin:'吞金兽', cup:'圣杯' };
const DEFAULT_SETTINGS = {
  itemChance: { '8':0, '15':2, '25':4 },
  itemWeights: { '15':{wadang:100}, '25':{wadang:50, sword:30, tunjin:20} },
  moneyWeights: Object.fromEntries(MONEY_VALUES.map(v=>[String(v),1]))
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
    out.itemWeights['15'].wadang = clampWeight(s.itemWeights['15']?.wadang, out.itemWeights['15'].wadang);
    for (const item of ['wadang','sword','tunjin']) {
      out.itemWeights['25'][item] = clampWeight(s.itemWeights['25']?.[item], out.itemWeights['25'][item]);
    }
  }
  if (s && s.moneyWeights) {
    for (const v of MONEY_VALUES) out.moneyWeights[String(v)] = clampWeight(s.moneyWeights[String(v)], out.moneyWeights[String(v)]);
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
    const item = level === 15 ? 'wadang' : weightedPick(settings.itemWeights[String(level)] || {}, allowed);
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
        limit:rec.limit, sequence:draw.sequence, redeemedAtBeijing:redeem.redeemedAtBeijing,
        remainingTickets:Math.max(0, rec.totalTickets - rec.usedTickets),
        totalTickets:rec.totalTickets, usedTickets:rec.usedTickets, expiresAt:rec.expiresAt
      });
    }

    return jsonResp(404, { error:'接口不存在', path });
  } catch (err) {
    return jsonResp(500, { error:err.message || '服务器错误' });
  }
};
