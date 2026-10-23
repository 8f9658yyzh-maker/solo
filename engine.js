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
  return { seats: 4, ante: 1, limit: 3, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 10, startPts: 100, upEnabled: true, upLimit: null, upLimitType: null, gameMaxBets: 0, gameMaxUps: 0, shugiMul: 1, jpRank: 10 };
}
function normalizeCfg(c) {
  const int = (v, lo, hi, d) => { v = Math.floor(Number(v)); if (!isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); };
  const o = {};
  o.seats = int(c.seats, 2, 10, 4);
  o.minUnit = int(c.minUnit, 1, 100000, 1);   // アプリ全体の最小単位(参加料・最低ベットはこれ以上)
  o.ante = int(c.ante, o.minUnit, 100000, o.minUnit);
  o.minBet = int(c.minBet, o.minUnit, 100000, o.minUnit);
  o.limit = int(c.limit, o.minBet, 1000000, 3);
  o.limitType = c.limitType === 'perGame' ? 'perGame' : 'perBet';
  o.maxBets = int(c.maxBets, 1, 5, 3);
  o.reserve = int(c.reserve, 0, 100000, 10);
  // 祝儀 = 参加料 × ソロの数字 × 倍率(0=祝儀なし)。払えなくならないよう、最大額ぶんは必ず手元に残す
  o.shugiMul = int(c.shugiMul, 0, 10, 1);
  if (o.shugiMul > 0) o.reserve = Math.max(o.reserve, Math.min(10000000, o.ante * 10 * o.shugiMul));
  o.jpRank = int(c.jpRank, 1, 10, 10);   // この数字以上のソロでジャックポット
  o.startPts = int(c.startPts, 1, 1000000, 100);
  o.upEnabled = c.upEnabled === false || c.upEnabled === 'off' ? false : true;
  // ビキのアップの上限は、親のベットの上限とは別に決められる(未指定なら親と同じ)
  o.upLimit = c.upLimit == null || c.upLimit === '' ? o.limit : int(c.upLimit, o.minBet, 1000000, o.limit);
  o.upLimitType = c.upLimitType === 'perGame' ? 'perGame' : c.upLimitType === 'perBet' ? 'perBet' : o.limitType;
  // 親やビキが変わっても、1ゲーム全体でのベット・アップの回数に上限をつける設定(0=つけない)
  o.gameMaxBets = int(c.gameMaxBets, 0, 50, 0);
  o.upResetOnOya = c.upResetOnOya !== false && c.upResetOnOya !== 0;
  o.gameMaxUps = int(c.gameMaxUps, 0, 50, 0);
  o.startPts = Math.max(o.startPts, o.ante + o.reserve + Math.max(o.limit, o.upLimit));
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
  return { cfg, players, color: 'red', pot: 0, stake: {}, carry: null, nextOya: null, gameNo: 0, history: [], injected: 0, g: null, feeBp: Math.max(0, Math.floor(Number(opts.feeBp) || 0)), feeNew: 0,
    jpBp: Math.max(0, Math.floor(Number(opts.jpBp) || 0)), jp: { pool: 0, ent: {} } };
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
  const parts = [], skipped = [], shortOut = [], shorts = [];
  const isSv = s => carrying && T.carry.survivors.includes(s);
  const needOf = s => isSv(s) ? cfg.ante : T.carry.fee + cfg.ante;
  for (let s = 0; s < n; s++) {
    if (P(s).vacant || P(s).sitout) continue;   // sitout = 参加費が払えず休んでいる人
    if (carrying) {
      // 払うチップが足りない人は、「払える分だけ払って参加」にはしない(大きな場に少額で参加できてしまうため)
      if (avail(s) < needOf(s)) { shorts.push(s); continue; }
      if (isSv(s)) { parts.push(s); continue; }
      // 流しの前に降りた人は、(1人分+10%)と参加料を払って入るか、この試合を見送るかを選べる
      let resp;
      const req = { type: 'carryJoin', seat: s, fee: T.carry.fee, ante: cfg.ante, pot: T.pot, round: 0 };
      if (P(s).human && io.human) { sync(); resp = await io.human(req); }
      else { await beat(300); resp = { act: Math.random() < 0.75 ? 'join' : 'skip' }; }
      if (resp && resp.act === 'join') parts.push(s); else skipped.push(s);
    } else if (P(s).pts >= cfg.ante + cfg.reserve) parts.push(s);
  }
  // 足りない人には猶予(サーバー側で5分)を渡す。その間にAJからチップをもらい、卓に移して戻れば参加できる。
  // 足りない人が複数いても、順番ではなく同じ猶予の中で、それぞれが同時に決める
  if (shorts.length) {
    if (io.grace && io.human) sync();
    const outs = await Promise.all(shorts.map(async s => {
      if (!(P(s).human && io.human && io.grace)) return false;
      const resp = await io.human({ type: 'carryJoin', short: true, survivor: isSv(s), seat: s, need: needOf(s), have: avail(s), fee: T.carry.fee, ante: cfg.ante, pot: T.pot, round: 0 });
      return !!(resp && resp.act === 'join' && avail(s) >= needOf(s));
    }));
    shorts.forEach((s, k) => { if (outs[k]) parts.push(s); else shortOut.push(s); });
  }
  parts.sort((a, b) => a - b);
  if (parts.length < 2) return { type: 'nogame', parts };

  const g = {
    no: ++T.gameNo, color: T.color, parts: parts.slice(), active: new Set(parts),
    hands: {}, ev: {}, paid: {}, startPts: {}, say: {}, carried: carrying ? T.pot : 0,
    round: 0, curBet: 0, curUp: 0, epoch: { bets: 0, total: 0 }, bikiE: { seat: null, total: 0 }, totalBets: 0, totalUps: 0,
    phase: 'deal', oya: null, acting: null, revealed: [], actions: []
  };
  T.g = g;
  parts.forEach(s => { g.paid[s] = 0; g.startPts[s] = P(s).pts; });
  const pay = (s, a) => { P(s).pts -= a; T.pot += a; g.paid[s] += a; T.stake[s] = (T.stake[s] || 0) + a; };

  // ---- 参加料 ----
  if (!carrying) {
    T.stake = {};
    parts.forEach(s => pay(s, cfg.ante));
    log(`ゲーム${g.no}（${COLOR_NAME[g.color]}の山札）。参加料 ${cfg.ante}チップを ${parts.length}人が出しました`, 'info');
  } else {
    const fee = T.carry.fee, sv = T.carry.survivors;
    parts.forEach(s => { if (!sv.includes(s)) pay(s, fee); });
    const joiners = parts.filter(s => !sv.includes(s));
    // 流した次のゲームでも、参加する全員が参加料をもう一度払う
    parts.forEach(s => pay(s, cfg.ante));
    log(`ゲーム${g.no}（${COLOR_NAME[g.color]}の山札）。前の流しで場に ${g.carried}チップが残っています。参加料 ${cfg.ante}チップを ${parts.length}人が出しました` +
      (joiners.length ? `。${joiners.map(nm).join('・')}は ${fee}チップを払って参加` : '') +
      (skipped.length ? `。${skipped.map(nm).join('・')}は見送り` : '') + (shortOut.length ? `。${shortOut.map(nm).join('・')}はチップ不足で不参加` : ''), 'info');
  }
  const sitting = [];
  for (let s = 0; s < n; s++) if (!parts.includes(s) && !P(s).vacant && !skipped.includes(s)) sitting.push(s);
  if (sitting.length) log(`不参加（チップ不足）：${sitting.map(nm).join('・')}`, 'info');

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
  // 画面で「シャッフル→1枚ずつ配る」演出を見せる時間(人数が多いほど長い)
  await beat(1800 + 350 * order.length);

  // ---- 共通の関数 ----
  async function ask(req) {
    req.pot = T.pot; req.round = g.round;
    g.acting = req.seat; g.actType = req.type; sync();
    let resp;
    if (P(req.seat).human && io.human) resp = await io.human(req);
    else { await beat(650); resp = cpuDecide(T, g, req); }
    g.acting = null;
    return resp || { act: 'fold' };
  }
  const rec = (s, act, amount) => g.actions.push({ round: g.round, seat: s, act, amount: amount || 0 });
  function fold(s, why) {
    g.active.delete(s); rec(s, why === 'poor' ? 'fold_poor' : 'fold');
    g.say[s] = '降り';
    log(`${nm(s)}は降りました` + (why === 'poor' ? '（チップ不足で自動）' : ''), 'fold');
    if (g.active.size >= 2 && s === g.oya) {
      let o = s;
      do { o = (o + 1) % n; } while (!g.active.has(o));
      g.oya = o; g.epoch = { bets: 0, total: 0 }; if (cfg.upResetOnOya !== false) g.bikiE = { seat: null, total: 0 };
      log(`親が ${nm(o)} に変わりました（ベット回数と上限が最初に戻ります）`, 'oya');
    }
    sync();
  }
  async function respond(s, amount, kind) {
    if (!g.active.has(s)) return;
    if (avail(s) < amount) { fold(s, 'poor'); await beat(250); return; }
    const resp = await ask({ type: kind === 'bet' ? 'follow' : 'followUp', seat: s, amount, from: kind === 'bet' ? g.oya : g.bikiE.seat });
    if (resp.act === 'follow') {
      pay(s, amount); g.say[s] = 'ついていく'; rec(s, kind === 'up' ? 'call_up' : 'call', amount);
      log(`${nm(s)}は ${amount}チップついていきました`, 'follow'); sync();
    } else fold(s);
  }

  // ---- ベットの流れ ----
  for (;;) {
    if (g.active.size === 1) break;
    const r = ring(T, g), oyaS = g.oya;
    const exhausted = g.epoch.bets >= cfg.maxBets ||
      (cfg.gameMaxBets > 0 && g.totalBets >= cfg.gameMaxBets) ||
      (cfg.limitType === 'perGame' && cfg.limit - g.epoch.total < cfg.minBet);
    if (exhausted) { g.showReason = 'limit'; log('親のベットが上限まで進んだので、勝負します', 'show'); break; }
    const capBase = cfg.limitType === 'perBet' ? cfg.limit : cfg.limit - g.epoch.total;
    const cap = Math.min(capBase, avail(oyaS));
    const canBet = cap >= cfg.minBet;
    const canShow = r.length === 2;
    if (!canBet && !canShow) { fold(oyaS, 'poor'); await beat(250); continue; }
    g.say = {}; g.curBet = 0; g.curUp = 0; // 新しいラウンド
    const resp = await ask({
      type: 'oya', seat: oyaS, canBet, minBet: cfg.minBet, cap, canShow,
      betsLeft: Math.min(cfg.maxBets - g.epoch.bets, cfg.gameMaxBets > 0 ? cfg.gameMaxBets - g.totalBets : 99), epochTotal: g.epoch.total
    });
    if (resp.act === 'show' && canShow) { rec(oyaS, 'show'); g.showReason = 'show'; log(`${nm(oyaS)}が勝負を選びました`, 'show'); break; }
    if (resp.act !== 'bet' || !canBet) { fold(oyaS); continue; }

    const a = Math.max(cfg.minBet, Math.min(cap, Math.floor(Number(resp.amount) || cfg.minBet)));
    pay(oyaS, a); rec(oyaS, 'bet', a); g.epoch.bets++; g.totalBets++; g.epoch.total += a; g.round++;
    g.say[oyaS] = 'ベット ' + a; g.curBet = a; g.curUp = 0;
    log(`親の ${nm(oyaS)}が ${a}チップベット（${g.epoch.bets}回目）`, 'bet'); sync();

    const others = r.slice(1);
    const bikiS = cfg.upEnabled ? others[others.length - 1] : -1;
    for (const s of others) {
      if (g.active.size === 1) break;
      if (s === bikiS) continue;
      await respond(s, a, 'bet');
    }
    if (g.active.size === 1) break;

    if (bikiS >= 0 && g.active.has(bikiS)) {
      if (g.bikiE.seat !== bikiS) g.bikiE = { seat: bikiS, total: 0 };
      if (avail(bikiS) < a) { fold(bikiS, 'poor'); await beat(250); }
      else {
        let capUp = cfg.upLimitType === 'perBet' ? cfg.upLimit : cfg.upLimit - g.bikiE.total;
        if (cfg.gameMaxUps > 0 && g.totalUps >= cfg.gameMaxUps) capUp = 0;   // 1ゲームのアップ回数の上限
        const upCap = Math.min(capUp, avail(bikiS) - a);
        const br = await ask({ type: 'biki', seat: bikiS, amount: a, minUp: cfg.minBet, upCap: upCap >= cfg.minBet ? upCap : 0, upTotal: g.bikiE.total, upsLeft: cfg.gameMaxUps > 0 ? Math.max(0, cfg.gameMaxUps - g.totalUps) : 99 });
        if (br.act !== 'follow') fold(bikiS);
        else {
          pay(bikiS, a); g.say[bikiS] = 'ついていく'; rec(bikiS, 'call', a);
          let up = Math.floor(Number(br.up) || 0);
          if (upCap >= cfg.minBet && up >= cfg.minBet) {
            up = Math.min(up, upCap);
            pay(bikiS, up); rec(bikiS, 'up', up); g.bikiE.total += up; g.totalUps++;
            g.say[bikiS] = 'アップ ' + up; g.curUp = up;
            log(`ビキの ${nm(bikiS)}が ${a}チップついていき、${up}チップアップ`, 'up'); sync();
            const ups = ring(T, g).filter(x => x !== bikiS);
            for (const s of ups) {
              if (g.active.size === 1) break;
              await respond(s, up, 'up');
            }
          } else {
            log(`ビキの ${nm(bikiS)}は ${a}チップついていきました（アップなし）`, 'follow'); sync();
          }
        }
      }
    }
    await beat(300);
  }

  // ---- 決着 ----
  function settleWin(w, how) {
    const potGross = T.pot;
    // 手数料: 運営の取り分(feeBp)と、ジャックポットの積立(jpBp)。どちらも切り上げ
    let fee = T.feeBp ? Math.ceil(potGross * T.feeBp / 10000) : 0;
    let cut = T.jpBp ? Math.ceil(potGross * T.jpBp / 10000) : 0;
    if (fee + cut > potGross) cut = Math.max(0, potGross - fee);
    const potWon = potGross - fee - cut;
    P(w).pts += potWon; T.feeNew += fee; T.pot = 0; T.stake = {}; T.carry = null;
    // 積立: このゲームに参加した全員が「この額の積立に貢献した」ことになる(途中参加の按分のもと)
    if (cut > 0) { T.jp.pool += cut; g.parts.forEach(s => { T.jp.ent[s] = (T.jp.ent[s] || 0) + cut; }); }
    let shugi = null, flipped = false, jp = null;
    const h = g.ev[w];
    const hit = h.kind === 'solo' && h.rank >= cfg.jpRank;   // ジャックポットの当たり
    if (how === 'show' && h.kind === 'solo' && cfg.shugiMul > 0) {
      const unit = cfg.ante * h.rank * cfg.shugiMul, items = []; let total = 0;
      g.parts.filter(s => s !== w).forEach(s => {
        const a = Math.min(unit, P(s).pts);
        P(s).pts -= a; P(w).pts += a; total += a; items.push({ seat: s, amount: a });
      });
      shugi = { rank: h.rank, unit, total, items };
      log(`${h.label}の祝儀！ 他の${items.length}人から ${unit}チップずつ（参加料${cfg.ante}×${h.rank}${cfg.shugiMul > 1 ? '×' + cfg.shugiMul : ''}）、合計 ${total}チップ`, 'shugi');
    }
    if (hit && T.jp.pool > 0) {
      const before = T.jp.pool, mine = T.jp.ent[w] || 0, pay = Math.min(mine, before);
      P(w).pts += pay; T.jp.pool = before - pay;
      jp = { paid: pay, pool: before, mine, reveal: how === 'fold', rank: h.rank, cut };
      T.jp.ent = {};
      if (T.jp.pool > 0) T.players.forEach((p, s) => { if (!p.vacant) T.jp.ent[s] = T.jp.pool; });   // 残りは今いる人の次の積立へ
      log(`🎰 ジャックポット！ ${nm(w)}が積立 ${before}チップのうち ${pay}チップを受け取りました` +
        (pay < before ? `（途中から参加したため、参加してからの積み上がり分だけ。残り ${T.jp.pool}チップは次の積立へ）` : ''), 'shugi');
      if (how === 'fold') { g.revealed = [w]; log(`${nm(w)}の手札は ${h.label} でした`, 'shugi'); }
    }
    if (h.kind === 'solo' && h.rank === 10 && (how === 'show' || jp)) {
      T.color = T.color === 'red' ? 'black' : 'red'; flipped = true;
      log(`10のソロが出たので、次のゲームから山札は${COLOR_NAME[T.color]}になります`, 'shugi');
    }
    T.nextOya = w;
    log(`${nm(w)}の勝ち。` + (fee + cut ? `場の ${potGross}チップから手数料 ${fee + cut}チップ（運営 ${fee}・積立 ${cut}）を引いた ${potWon}チップを受け取りました` : `場の ${potWon}チップを受け取りました`) + (how === 'fold' ? '（全員が降りたので手札は見せません）' : ''), 'win');
    return { type: 'win', how, winner: w, potWon, potGross, fee, cut, shugi, jp, flipped, hand: h };
  }
  function settleNagashi(res, alive) {
    const maxStake = Math.max(...alive.map(s => T.stake[s] || 0));
    const fee = Math.ceil(maxStake * 11 / 10);
    T.carry = { survivors: alive.slice(), fee };
    const nextOya = res.candidates.length === 1 ? res.candidates[0] : rollOff(res.candidates, '親を決めるサイコロ').winner;
    T.nextOya = nextOya;
    log(`流しです（${res.reason === 'sixfour' ? '6と4が出ました' : '同じ強さで勝負がつきません'}）。場の ${T.pot}チップは次のゲームへ。次の親は ${nm(nextOya)}。` +
      `降りた人が次に入るには ${fee}チップ（1人分＋10%）`, 'nagashi');
    return { type: 'nagashi', reason: res.reason, candidates: res.candidates, fee, carry: T.pot, nextOya };
  }

  const alive = ring(T, g);
  const stakeSnap = Object.assign({}, T.stake);
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
  result.paid = Object.assign({}, g.paid); result.stake = stakeSnap; result.actions = g.actions.slice();
  result.showdown = result.type === 'win' && result.how === 'fold' ? (result.jp && result.jp.reveal ? [{ seat: result.winner, hand: g.hands[result.winner].map(c => c.n + c.s), label: g.ev[result.winner].label }] : []) : g.revealed.map(s => ({ seat: s, hand: g.hands[s].map(c => c.n + c.s), label: g.ev[s].label }));
  result.g = g;
  g.result = result;

  // CPUのチップ補充（人間は自分で補充）
  T.players.forEach((p, s) => {
    if (p.human) return;
    const need = (T.carry && !T.carry.survivors.includes(s)) ? T.carry.fee + cfg.ante : cfg.ante;
    if (p.pts - cfg.reserve < need) {
      const add = Math.max(0, cfg.startPts - p.pts);
      if (add > 0) { p.pts += add; T.injected += add; log(`${p.name}がチップを補充しました（+${add}チップ）`, 'info'); }
    }
  });

  T.history.push({
    no: g.no, color: g.color, how: result.type === 'win' ? result.how : 'nagashi',
    hash: g.commit.hash, str: g.commit.str, deckStr: g.commit.deckStr, hands: g.hands, winner: result.winner
  });
  sync();
  return result;
}

/* ================= ジャックポット: ラストゲームと分配 ================= */
function jpForget(T, seat) { if (T.jp && T.jp.ent) delete T.jp.ent[seat]; }   // 席を立つと、その人の積み上げ分はなくなる
// 積み上げ分に応じて積立を分ける(強制終了のとき)。合計は必ず pool と同じ。
function jpShares(T) {
  const jp = T.jp, pool = jp.pool, seats = T.players.map((p, s) => s).filter(s => !T.players[s].vacant);
  const out = {}; if (pool <= 0 || !seats.length) return out;
  let wsum = seats.reduce((a, s) => a + (jp.ent[s] || 0), 0), w = s => jp.ent[s] || 0;
  if (wsum <= 0) { wsum = seats.length; w = () => 1; }
  let given = 0; seats.forEach(s => { out[s] = Math.floor(pool * w(s) / wsum); given += out[s]; });
  const top = seats.slice().sort((a, b) => w(b) - w(a) || a - b)[0]; out[top] += pool - given;
  return out;
}
// 終了時のラストゲーム: 参加料・ベット・親・祝儀なし。全員が手札を見せ、強い人が積立をもらう(途中参加の人は自分の積み上げ分まで)。
// 取り切れなかった分は、次に強い人へ回る。同じ強さのときは、その人たちだけで引き直す。
async function playLastGame(T, io) {
  io = io || {};
  const P = s => T.players[s], nm = s => P(s).name, jp = T.jp;
  const log = (m, k) => { if (io.log) io.log(m, k || ''); };
  const sync = () => { if (io.sync) io.sync(); };
  const beat = ms => (io.beat ? io.beat(ms) : Promise.resolve());
  if (!(jp.pool > 0)) return { type: 'nolast', rounds: [] };
  const seated = T.players.map((p, s) => s).filter(s => !P(s).vacant);
  let remaining = seated.filter(s => (jp.ent[s] || 0) > 0);
  if (!remaining.length) remaining = seated.slice();
  const everyone = remaining.slice(), rounds = [], total = {};
  log(`ラストゲーム！ 積立 ${jp.pool}チップを、手札の強さだけで決めます（参加料・ベット・親・祝儀はありません）`, 'shugi');
  sync(); await beat(1200);
  let place = 0;
  while (jp.pool > 0 && remaining.length) {
    place++;
    let cands = remaining.slice(), winner = null, g = null, ev = null, guard = 0;
    while (winner == null) {
      if (++guard > 60) { winner = cands[0]; break; }
      const order = cands.slice();
      g = { no: ++T.gameNo, color: T.color, parts: order.slice(), active: new Set(order), hands: {}, ev: {}, paid: {}, startPts: {}, say: {}, carried: 0,
        round: 0, curBet: 0, curUp: 0, epoch: { bets: 0, total: 0 }, bikiE: { seat: null, total: 0 }, totalBets: 0, totalUps: 0, phase: 'deal', oya: null, firstOya: order[0], acting: null, revealed: [], actions: [],
        last: { place, pool: jp.pool } };
      order.forEach(s => { g.paid[s] = 0; g.startPts[s] = P(s).pts; });
      T.g = g;
      const deck = shuffle(makeDeck(g.color)), salt = randomHex(16), deckStr = deck.map(c => c.n + c.s).join(' ');
      const commitStr = ['solo', 'game' + g.no, g.color, 'last', 'seats' + order.join(','), salt, deckStr].join('|');
      g.commit = { hash: sha256hex(commitStr), salt, deckStr, str: commitStr, order };
      order.forEach((s, i) => { g.hands[s] = [deck[i], deck[order.length + i]]; g.ev[s] = evalHand(g.hands[s][0].n, g.hands[s][1].n); });
      g.phase = 'bet'; sync(); await beat(1800 + 350 * order.length);
      g.phase = 'showdown'; g.revealed = order.slice();
      log(`ラストゲーム${place > 1 ? '（' + place + '位決め）' : ''}： ` + order.map(s => `${nm(s)}＝${g.ev[s].label}`).join('、'), 'show');
      sync(); await beat(1500);
      const res = resolveShowdown(order.map(s => ({ seat: s, hand: g.ev[s] })));
      if (res.type === 'win') { winner = res.winner; ev = g.ev[winner]; }
      else { log('同じ強さ（または流し）なので、引き直します', 'nagashi'); if (res.reason === 'tie') cands = res.candidates.slice(); await beat(800); }
    }
    const take = Math.min(jp.ent[winner] || 0, jp.pool) || (remaining.length === 1 ? jp.pool : 0);
    P(winner).pts += take; jp.pool -= take; total[winner] = (total[winner] || 0) + take;
    remaining = remaining.filter(s => s !== winner);
    const gg = g;
    gg.phase = 'done';
    const res = { type: 'win', how: 'jackpot', winner, potWon: take, potGross: 0, fee: 0, cut: 0, shugi: null, flipped: false, hand: ev || gg.ev[winner],
      jp: { paid: take, pool: take + jp.pool, mine: jp.ent[winner] || 0, last: true, place, left: jp.pool }, deltas: {}, paid: {}, stake: {}, actions: [],
      showdown: gg.revealed.map(s => ({ seat: s, hand: gg.hands[s].map(c => c.n + c.s), label: gg.ev[s].label })), g: gg };
    gg.parts.forEach(s => { res.deltas[s] = (s === winner ? take : 0); });
    gg.result = res;
    log(`🎰 ${nm(winner)}が積立から ${take}チップを受け取りました` + (jp.pool > 0 ? `（残り ${jp.pool}チップ）` : ''), 'win');
    T.history.push({ no: gg.no, color: gg.color, how: 'jackpot', hash: gg.commit.hash, str: gg.commit.str, deckStr: gg.commit.deckStr, hands: gg.hands, winner });
    jp.ent[winner] = 0;
    rounds.push(res); sync();
    if (io.roundDone) await io.roundDone(res); else await beat(1500);
  }
  if (jp.pool > 0) {   // 全員が受け取っても余った分は、参加者で等分(端数は最初の人)
    const n = everyone.length, each = Math.floor(jp.pool / n), rest = jp.pool - each * n;
    everyone.forEach((s, k) => { const a = each + (k === 0 ? rest : 0); P(s).pts += a; total[s] = (total[s] || 0) + a; });
    log(`余った積立 ${jp.pool}チップを、${n}人で等分しました`, 'info'); jp.pool = 0;
  }
  jp.ent = {};
  return { type: 'last', rounds, total };
}

const Solo = {
  VERSION: '1.0', randomInt, shuffle, randomHex, sha256hex, makeDeck, evalHand, cmp, resolveShowdown,
  category, categoryProbabilities, strength1, defaults, normalizeCfg, createTable, playGame, ring,
  cpuDecide, SUITS, COLOR_NAME, PIN_NAMES, playLastGame, jpForget, jpShares
};
root.Solo = Solo;
if (typeof module !== 'undefined' && module.exports) module.exports = Solo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
