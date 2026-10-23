/* ソロ ルールエンジン（画面なし）
 * 乱数 / 山札の指紋 / 役の判定 / ベットの流れ / 流し / 祝儀 / CPU
 */
(function (root) {
'use strict';

/* ================= 乱数（暗号用） ================= */
let CR = null;
if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') CR = globalThis.crypto;
else if (typeof require === 'function') { try { CR = require('node:crypto').webcrypto; } catch (e) { /* なし */ } }
function needCrypto() { if (!CR) throw new Error('この環境では暗号用の乱数が使えません'); }

// 0以上n未満の整数。割り算の余りの偏りを避けるため、範囲を超えた値は捨てて引き直す。
function randomInt(n) {
  needCrypto();
  if (!(n >= 1 && n <= 4294967296) || Math.floor(n) !== n) throw new RangeError('randomInt: n が不正です');
  const lim = Math.floor(4294967296 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do { CR.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % n;
}
// フィッシャー・イェーツ法
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function randomHex(bytes) {
  needCrypto();
  const b = new Uint8Array(bytes);
  CR.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/* ================= SHA-256（山札の指紋用） ================= */
const K256 = [], H0 = [];
(function () {
  const primes = [];
  for (let c = 2; primes.length < 64; c++) {
    let ok = true;
    for (const p of primes) { if (p * p > c) break; if (c % p === 0) { ok = false; break; } }
    if (ok) primes.push(c);
  }
  const frac = x => x - Math.floor(x);
  for (let i = 0; i < 64; i++) K256.push(Math.floor(frac(Math.cbrt(primes[i])) * 4294967296) >>> 0);
  for (let i = 0; i < 8; i++) H0.push(Math.floor(frac(Math.sqrt(primes[i])) * 4294967296) >>> 0);
})();
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256hex(str) {
  const bytes = new TextEncoder().encode(str);
  const l = bytes.length;
  const r = (l + 1) % 64;
  const padLen = r <= 56 ? 56 - r : 120 - r;
  const total = l + 1 + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((l * 8) / 4294967296));
  dv.setUint32(total - 4, (l * 8) >>> 0);
  let h = H0.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(x => x >>> 0);
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}

/* ================= カードと役 ================= */
const SUITS = { red: ['♥', '♦'], black: ['♠', '♣'] };
const COLOR_NAME = { red: '赤', black: '黒' };
const PIN_NAMES = { 5: 'ゴピン', 9: 'キュウピン', 10: 'ジッピン' };

function makeDeck(color) {
  const d = [];
  for (const s of SUITS[color]) for (let n = 1; n <= 10; n++) d.push({ n, s });
  return d;
}

// 役: solo(3) > pin(2) > point(1)。nagashi(6と4)は特別。
function evalHand(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const pts = (a + b) % 10;
  if (a === b) return { kind: 'solo', tier: 3, rank: a, pts, label: (a === 1 ? 'エース' : a) + 'のソロ' };
  if (lo === 1 && PIN_NAMES[hi]) return { kind: 'pin', tier: 2, rank: hi, pts, label: PIN_NAMES[hi] };
  if (lo === 4 && hi === 6) return { kind: 'nagashi', tier: 0, rank: 0, pts, label: '流し（6・4）' };
  return { kind: pts === 0 ? 'buta' : 'point', tier: 1, rank: pts, pts, label: pts === 0 ? '豚（0点）' : pts + '点' };
}
// 1: h1の勝ち / -1: h1の負け / 0: 勝負がつかない（流し）
function cmp(h1, h2) {
  const t1 = h1.kind === 'solo' && h1.rank === 10, t2 = h2.kind === 'solo' && h2.rank === 10;
  if (t1 && t2) return 0;
  if (t1) return 1;
  if (t2) return -1;
  if (h1.kind === 'nagashi' || h2.kind === 'nagashi') return 0;
  if (h1.tier !== h2.tier) return h1.tier > h2.tier ? 1 : -1;
  if (h1.rank !== h2.rank) return h1.rank > h2.rank ? 1 : -1;
  return 0;
}
// 勝負に残った人たちの結果。entries = [{seat, hand}]
function resolveShowdown(entries) {
  const top = entries.find(e => e.hand.kind === 'solo' && e.hand.rank === 10);
  if (top) return { type: 'win', winner: top.seat };
  const nag = entries.filter(e => e.hand.kind === 'nagashi');
  if (nag.length) return { type: 'nagashi', reason: 'sixfour', candidates: nag.map(e => e.seat) };
  let best = [entries[0]];
  for (let i = 1; i < entries.length; i++) {
    const c = cmp(entries[i].hand, best[0].hand);
    if (c > 0) best = [entries[i]]; else if (c === 0) best.push(entries[i]);
  }
  if (best.length > 1) return { type: 'nagashi', reason: 'tie', candidates: best.map(e => e.seat) };
  return { type: 'win', winner: best[0].seat };
}
function category(a, b) {
  const h = evalHand(a, b);
  if (h.kind === 'solo') return 'ソロ';
  if (h.kind === 'pin') return h.label;
  if (h.kind === 'nagashi') return '流し（6・4）';
  return h.pts === 0 ? '豚（0点）' : h.pts + '点';
}
// 20枚から2枚を選ぶ190通りを数えた、手札の種類ごとの確率（理論値）
function categoryProbabilities() {
  const d = makeDeck('red'), counts = {};
  let total = 0;
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
    const c = category(d[i].n, d[j].n); counts[c] = (counts[c] || 0) + 1; total++;
  }
  const out = {};
  for (const k in counts) out[k] = counts[k] / total;
  return out;
}

const RANKS = []; for (let n = 1; n <= 10; n++) RANKS.push(n, n);
const memo = {};
// 手札(a,b)が、他の1人のランダムな手札に勝つ確率（引き分けは0.5）
function strength1(a, b) {
  const key = Math.min(a, b) + ',' + Math.max(a, b);
  if (memo[key] !== undefined) return memo[key];
  const pool = RANKS.slice();
  pool.splice(pool.indexOf(a), 1); pool.splice(pool.indexOf(b), 1);
  const me = evalHand(a, b);
  let w = 0, p = 0, t = 0;
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const c = cmp(me, evalHand(pool[i], pool[j])); t++;
    if (c > 0) w++; else if (c === 0) p++;
  }
  return (memo[key] = (w + 0.5 * p) / t);
}

/* ================= 卓 ================= */
function defaults() {
  return { seats: 4, ante: 1, limit: 3, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 10, startPts: 100 };
}
function normalizeCfg(c) {
  const int = (v, lo, hi, d) => { v = Math.floor(Number(v)); if (!isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); };
  const o = {};
  o.seats = int(c.seats, 2, 10, 4);
  o.ante = int(c.ante, 1, 1000, 1);
  o.minBet = int(c.minBet, 1, 1000, 1);
  o.limit = int(c.limit, o.minBet, 10000, 3);
  o.limitType = c.limitType === 'perGame' ? 'perGame' : 'perBet';
  o.maxBets = int(c.maxBets, 1, 5, 3);
  o.reserve = int(c.reserve, 0, 100, 10);
  o.startPts = int(c.startPts, 1, 100000, 100);
  o.startPts = Math.max(o.startPts, o.ante + o.reserve + o.limit);
  return o;
}
const NAMES = ['あなた', 'ナナ', 'ケンジ', 'ユイ', 'タケシ', 'ミサキ', 'カズ', 'アヤ', 'シン', 'マナ'];
function makeCpu() { return { aggr: 0.3 + Math.random() * 0.5, bluff: 0.05 + Math.random() * 0.1, loose: Math.random() * 0.1 }; }

function createTable(userCfg, opts) {
  opts = opts || {};
  const cfg = normalizeCfg(Object.assign(defaults(), userCfg || {}));
  const humans = opts.humans || [0];
  const players = [];
  for (let i = 0; i < cfg.seats; i++) players.push({ id: i, name: NAMES[i], human: humans.includes(i), pts: cfg.startPts, cpu: makeCpu() });
  return { cfg, players, color: 'red', pot: 0, stake: {}, carry: null, nextOya: null, gameNo: 0, history: [], injected: 0, g: null };
}

function ring(T, g) {
  const n = T.players.length, out = [];
  for (let i = 0; i < n; i++) { const s = (g.oya + i) % n; if (g.active.has(s)) out.push(s); }
  return out;
}

/* ================= CPU ================= */
function cpuInfo(g, seat) {
  const h = g.hands[seat], hv = g.ev[seat];
  const v1 = strength1(h[0].n, h[1].n);
  const k = g.active.size - 1;
  return { hv, v1, k, pAll: Math.pow(v1, 1 + 0.4 * Math.max(0, k - 1)) };
}
function cpuWillFollow(K, p, T, amount, kind) {
  if (K.hv.kind === 'nagashi') return true;
  const odds = amount / (T.pot + amount);
  const need = odds * 1.15 + (kind === 'up' ? 0.06 : 0) + 0.10 * (1 - p.aggr) + 0.04 - p.loose + (Math.random() - 0.5) * 0.14;
  return K.pAll >= need;
}
function pick(f, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, f))))); }
function cpuDecide(T, g, req) {
  const p = T.players[req.seat].cpu || { aggr: 0.5, bluff: 0.08, loose: 0.05 };
  const K = cpuInfo(g, req.seat);
  if (req.type === 'oya') {
    if (!req.canBet) return (req.canShow && K.v1 >= 0.4) ? { act: 'show' } : { act: 'fold' };
    if (K.hv.kind === 'nagashi') {
      if (req.canShow && Math.random() < 0.2) return { act: 'show' };
      return { act: 'bet', amount: pick(0.4 + Math.random() * 0.6, req.minBet, req.cap) };
    }
    const bluff = Math.random() < p.bluff;
    if (K.pAll < 0.28 && !bluff) return (req.canShow && K.v1 >= 0.45) ? { act: 'show' } : { act: 'fold' };
    if (req.canShow && K.v1 > 0.6 && Math.random() < 0.3) return { act: 'show' };
    const f = (K.pAll - 0.2) * 1.5 + (Math.random() - 0.5) * 0.35 + (bluff ? 0.4 : 0);
    return { act: 'bet', amount: pick(f, req.minBet, req.cap) };
  }
  if (req.type === 'follow' || req.type === 'followUp') {
    return { act: cpuWillFollow(K, p, T, req.amount, req.type === 'followUp' ? 'up' : 'bet') ? 'follow' : 'fold' };
  }
  if (req.type === 'biki') {
    if (!cpuWillFollow(K, p, T, req.amount, 'bet')) return { act: 'fold' };
    let up = 0;
    if (req.upCap >= req.minUp) {
      const bluff = Math.random() < p.bluff;
      const go = K.hv.kind === 'nagashi' ? Math.random() < 0.55 : ((K.pAll > 0.45 && Math.random() < p.aggr) || bluff);
      if (go) {
        const f = K.hv.kind === 'nagashi' ? Math.random() : (K.pAll - 0.3) * 1.5 + Math.random() * 0.3;
        up = pick(f, req.minUp, req.upCap);
      }
    }
    return { act: 'follow', up };
  }
  return { act: 'fold' };
}

/* ================= 1ゲーム ================= */
async function playGame(T, io, opts) {
  io = io || {}; opts = opts || {};
  const cfg = T.cfg, n = T.players.length;
  const P = s => T.players[s];
  const nm = s => P(s).name;
  const log = (m, k) => { if (io.log) io.log(m, k || ''); };
  const sync = () => { if (io.sync) io.sync(); };
  const beat = ms => (io.beat ? io.beat(ms) : Promise.resolve());
  const avail = s => Math.max(0, P(s).pts - cfg.reserve);

  // ---- 参加者 ----
  const carrying = T.pot > 0 && !!T.carry;
  const parts = [];
  for (let s = 0; s < n; s++) {
    if (carrying) { if (T.carry.survivors.includes(s) || avail(s) >= T.carry.fee) parts.push(s); }
    else if (P(s).pts >= cfg.ante + cfg.reserve) parts.push(s);
  }
  if (parts.length < 2) return { type: 'nogame', parts };

  const g = {
    no: ++T.gameNo, color: T.color, parts: parts.slice(), active: new Set(parts),
    hands: {}, ev: {}, paid: {}, startPts: {}, say: {}, carried: carrying ? T.pot : 0,
    round: 0, epoch: { bets: 0, total: 0 }, bikiE: { seat: null, total: 0 },
    phase: 'deal', oya: null, acting: null, revealed: []
  };
  T.g = g;
  parts.forEach(s => { g.paid[s] = 0; g.startPts[s] = P(s).pts; });
  const pay = (s, a) => { P(s).pts -= a; T.pot += a; g.paid[s] += a; T.stake[s] = (T.stake[s] || 0) + a; };

  // ---- 参加料 ----
  if (!carrying) {
    T.stake = {};
    parts.forEach(s => pay(s, cfg.ante));
    log(`ゲーム${g.no}（${COLOR_NAME[g.color]}の山札）。参加料 ${cfg.ante}pt を ${parts.length}人が出しました`, 'info');
  } else {
    const fee = T.carry.fee, sv = T.carry.survivors;
    parts.forEach(s => { if (!sv.includes(s)) { T.stake[s] = 0; pay(s, fee); } });
    const joiners = parts.filter(s => !sv.includes(s));
    log(`ゲーム${g.no}（${COLOR_NAME[g.color]}の山札）。前の流しで場に ${g.carried}pt が残っています` +
      (joiners.length ? `。${joiners.map(nm).join('・')}は ${fee}pt を払って参加` : ''), 'info');
  }
  const sitting = [];
  for (let s = 0; s < n; s++) if (!parts.includes(s)) sitting.push(s);
  if (sitting.length) log(`不参加（ポイント不足）：${sitting.map(nm).join('・')}`, 'info');

  // ---- 親 ----
  function rollOff(cands, title) {
    let pool = cands.slice();
    for (;;) {
      const rolls = pool.map(s => ({ seat: s, v: randomInt(6) + 1 }));
      const mx = Math.max(...rolls.map(r => r.v));
      const top = rolls.filter(r => r.v === mx).map(r => r.seat);
      log(`${title}：` + rolls.map(r => `${nm(r.seat)} 出目${r.v}`).join('、'), 'dice');
      if (top.length === 1) return { winner: top[0] };
      log('同じ最高の出目が出たので、その人たちでもう一度振ります', 'dice');
      pool = top;
    }
  }
  let oya;
  if (opts.oya != null && parts.includes(opts.oya)) oya = opts.oya;
  else if (T.nextOya == null) oya = rollOff(parts, '最初の親をサイコロで決めます').winner;
  else { oya = T.nextOya; for (let i = 0; i < n && !parts.includes(oya); i++) oya = (oya + 1) % n; }
  g.oya = oya;
  g.firstOya = oya;

  // ---- 配る（配る前に山札の指紋を作る） ----
  const deck = shuffle(makeDeck(g.color));
  const salt = randomHex(16);
  const order = [];
  for (let i = 0; i < n; i++) { const s = (oya + i) % n; if (parts.includes(s)) order.push(s); }
  const deckStr = deck.map(c => c.n + c.s).join(' ');
  const commitStr = ['solo', 'game' + g.no, g.color, 'oya' + oya, 'seats' + order.join(','), salt, deckStr].join('|');
  g.commit = { hash: sha256hex(commitStr), salt, deckStr, str: commitStr, order };
  if (opts.fixedHands) {
    const sfx = SUITS[g.color];
    order.forEach(s => { const h = opts.fixedHands[s]; g.hands[s] = [{ n: h[0], s: sfx[0] }, { n: h[1], s: sfx[1] }]; });
    g.commit.fixed = true;
  } else {
    order.forEach((s, i) => { g.hands[s] = [deck[i], deck[order.length + i]]; });
  }
  parts.forEach(s => { g.ev[s] = evalHand(g.hands[s][0].n, g.hands[s][1].n); });
  log(`親は ${nm(oya)}。山札の指紋 ${g.commit.hash.slice(0, 16)}… を先に出してから配りました`, 'oya');
  g.phase = 'bet';
  sync();
  await beat(500);

  // ---- 共通の関数 ----
  async function ask(req) {
    req.pot = T.pot; req.round = g.round;
    g.acting = req.seat; sync();
    let resp;
    if (P(req.seat).human && io.human) resp = await io.human(req);
    else { await beat(650); resp = cpuDecide(T, g, req); }
    g.acting = null;
    return resp || { act: 'fold' };
  }
  function fold(s, why) {
    g.active.delete(s);
    g.say[s] = '降り';
    log(`${nm(s)}は降りました` + (why === 'poor' ? '（ポイント不足で自動）' : ''), 'fold');
    if (g.active.size >= 2 && s === g.oya) {
      let o = s;
      do { o = (o + 1) % n; } while (!g.active.has(o));
      g.oya = o; g.epoch = { bets: 0, total: 0 }; g.bikiE = { seat: null, total: 0 };
      log(`親が ${nm(o)} に変わりました（ベット回数と上限が最初に戻ります）`, 'oya');
    }
    sync();
  }
  async function respond(s, amount, kind) {
    if (!g.active.has(s)) return;
    if (avail(s) < amount) { fold(s, 'poor'); await beat(250); return; }
    const resp = await ask({ type: kind === 'bet' ? 'follow' : 'followUp', seat: s, amount, from: kind === 'bet' ? g.oya : g.bikiE.seat });
    if (resp.act === 'follow') {
      pay(s, amount); g.say[s] = 'ついていく';
      log(`${nm(s)}は ${amount}pt ついていきました`, 'follow'); sync();
    } else fold(s);
  }

  // ---- ベットの流れ ----
  for (;;) {
    if (g.active.size === 1) break;
    const r = ring(T, g), oyaS = g.oya;
    const exhausted = g.epoch.bets >= cfg.maxBets ||
      (cfg.limitType === 'perGame' && cfg.limit - g.epoch.total < cfg.minBet);
    if (exhausted) { g.showReason = 'limit'; log('親のベットが上限まで進んだので、勝負します', 'show'); break; }
    const capBase = cfg.limitType === 'perBet' ? cfg.limit : cfg.limit - g.epoch.total;
    const cap = Math.min(capBase, avail(oyaS));
    const canBet = cap >= cfg.minBet;
    const canShow = r.length === 2;
    if (!canBet && !canShow) { fold(oyaS, 'poor'); await beat(250); continue; }
    g.say = {}; // 新しいラウンド
    const resp = await ask({
      type: 'oya', seat: oyaS, canBet, minBet: cfg.minBet, cap, canShow,
      betsLeft: cfg.maxBets - g.epoch.bets, epochTotal: g.epoch.total
    });
    if (resp.act === 'show' && canShow) { g.showReason = 'show'; log(`${nm(oyaS)}が勝負を選びました`, 'show'); break; }
    if (resp.act !== 'bet' || !canBet) { fold(oyaS); continue; }

    const a = Math.max(cfg.minBet, Math.min(cap, Math.floor(Number(resp.amount) || cfg.minBet)));
    pay(oyaS, a); g.epoch.bets++; g.epoch.total += a; g.round++;
    g.say[oyaS] = 'ベット ' + a;
    log(`親の ${nm(oyaS)}が ${a}pt ベット（${g.epoch.bets}回目）`, 'bet'); sync();

    const others = r.slice(1);
    const bikiS = others[others.length - 1];
    for (const s of others) {
      if (g.active.size === 1) break;
      if (s === bikiS) continue;
      await respond(s, a, 'bet');
    }
    if (g.active.size === 1) break;

    if (g.active.has(bikiS)) {
      if (g.bikiE.seat !== bikiS) g.bikiE = { seat: bikiS, total: 0 };
      if (avail(bikiS) < a) { fold(bikiS, 'poor'); await beat(250); }
      else {
        const capUp = cfg.limitType === 'perBet' ? cfg.limit : cfg.limit - g.bikiE.total;
        const upCap = Math.min(capUp, avail(bikiS) - a);
        const br = await ask({ type: 'biki', seat: bikiS, amount: a, minUp: cfg.minBet, upCap: upCap >= cfg.minBet ? upCap : 0, upTotal: g.bikiE.total });
        if (br.act !== 'follow') fold(bikiS);
        else {
          pay(bikiS, a); g.say[bikiS] = 'ついていく';
          let up = Math.floor(Number(br.up) || 0);
          if (upCap >= cfg.minBet && up >= cfg.minBet) {
            up = Math.min(up, upCap);
            pay(bikiS, up); g.bikiE.total += up;
            g.say[bikiS] = 'アップ ' + up;
            log(`ビキの ${nm(bikiS)}が ${a}pt ついていき、${up}pt アップ`, 'up'); sync();
            const ups = ring(T, g).filter(x => x !== bikiS);
            for (const s of ups) {
              if (g.active.size === 1) break;
              await respond(s, up, 'up');
            }
          } else {
            log(`ビキの ${nm(bikiS)}は ${a}pt ついていきました（アップなし）`, 'follow'); sync();
          }
        }
      }
    }
    await beat(300);
  }

  // ---- 決着 ----
  function settleWin(w, how) {
    const potWon = T.pot; P(w).pts += potWon; T.pot = 0; T.stake = {}; T.carry = null;
    let shugi = null, flipped = false;
    const h = g.ev[w];
    if (how === 'show' && h.kind === 'solo') {
      const items = []; let total = 0;
      g.parts.filter(s => s !== w).forEach(s => {
        const a = Math.min(h.rank, P(s).pts);
        P(s).pts -= a; P(w).pts += a; total += a; items.push({ seat: s, amount: a });
      });
      shugi = { rank: h.rank, total, items };
      log(`${h.label}の祝儀！ 他の${items.length}人から ${h.rank}pt ずつ、合計 ${total}pt`, 'shugi');
      if (h.rank === 10) {
        T.color = T.color === 'red' ? 'black' : 'red'; flipped = true;
        log(`10のソロが出たので、次のゲームから山札は${COLOR_NAME[T.color]}になります`, 'shugi');
      }
    }
    T.nextOya = w;
    log(`${nm(w)}の勝ち。場の ${potWon}pt を受け取りました` + (how === 'fold' ? '（全員が降りたので手札は見せません）' : ''), 'win');
    return { type: 'win', how, winner: w, potWon, shugi, flipped, hand: h };
  }
  function settleNagashi(res, alive) {
    const maxStake = Math.max(...alive.map(s => T.stake[s] || 0));
    const fee = Math.ceil(maxStake * 11 / 10);
    const st = {}; alive.forEach(s => { st[s] = T.stake[s] || 0; }); T.stake = st;
    T.carry = { survivors: alive.slice(), fee };
    const nextOya = res.candidates.length === 1 ? res.candidates[0] : rollOff(res.candidates, '親を決めるサイコロ').winner;
    T.nextOya = nextOya;
    log(`流しです（${res.reason === 'sixfour' ? '6と4が出ました' : '同じ強さで勝負がつきません'}）。場の ${T.pot}pt は次のゲームへ。次の親は ${nm(nextOya)}。` +
      `降りた人が次に入るには ${fee}pt（1人分＋10%）`, 'nagashi');
    return { type: 'nagashi', reason: res.reason, candidates: res.candidates, fee, carry: T.pot, nextOya };
  }

  const alive = ring(T, g);
  let result;
  if (alive.length === 1) {
    g.phase = 'done';
    result = settleWin(alive[0], 'fold');
  } else {
    g.phase = 'showdown'; g.revealed = alive.slice();
    log('勝負！ 残った人の手札を見せます： ' + alive.map(s => `${nm(s)}＝${g.ev[s].label}`).join('、'), 'show');
    sync(); await beat(900);
    const res = resolveShowdown(alive.map(s => ({ seat: s, hand: g.ev[s] })));
    g.phase = 'done';
    result = res.type === 'win' ? settleWin(res.winner, 'show') : settleNagashi(res, alive);
  }
  g.phase = 'done';
  result.deltas = {};
  g.parts.forEach(s => { result.deltas[s] = P(s).pts - g.startPts[s]; });
  result.g = g;
  g.result = result;

  // CPUのポイント補充（人間は自分で補充）
  T.players.forEach((p, s) => {
    if (p.human) return;
    const need = (T.carry && !T.carry.survivors.includes(s)) ? T.carry.fee : cfg.ante;
    if (p.pts - cfg.reserve < need) {
      const add = Math.max(0, cfg.startPts - p.pts);
      if (add > 0) { p.pts += add; T.injected += add; log(`${p.name}がポイントを補充しました（+${add}pt）`, 'info'); }
    }
  });

  T.history.push({
    no: g.no, color: g.color, how: result.type === 'win' ? result.how : 'nagashi',
    hash: g.commit.hash, str: g.commit.str, deckStr: g.commit.deckStr, hands: g.hands, winner: result.winner
  });
  sync();
  return result;
}

const Solo = {
  VERSION: '1.0', randomInt, shuffle, randomHex, sha256hex, makeDeck, evalHand, cmp, resolveShowdown,
  category, categoryProbabilities, strength1, defaults, normalizeCfg, createTable, playGame, ring,
  cpuDecide, SUITS, COLOR_NAME, PIN_NAMES
};
root.Solo = Solo;
if (typeof module !== 'undefined' && module.exports) module.exports = Solo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
