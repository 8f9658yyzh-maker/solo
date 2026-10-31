'use strict';
// ソロの戦略を、戦略どうしで戦わせて強くする(ルールの分析用。本番の卓では使わない)
// 動かすたびに、保存した戦略の続きから学習する。結果はCSVに保存する(表計算ソフトで開ける)
//   node analysis/strategy.js [--gens 20] [--games 500] [--rounds 4] [--seats 6] [--buyin 5000] [--data analysis/data] [--fresh]
//   --gens 世代の数 / --games 1回の対戦のゲーム数 / --rounds 1世代で席を組み替える回数 / --buyin 持ち込みチップ / --fresh 保存した戦略を使わず最初から
const fs = require('node:fs'), path = require('node:path');
const Solo = require('../engine.js');
const { normSettings } = require('../server/tables');

// ---- 卓のルール(サーバーと同じ決め方。運営1%・積立2%・最小単位100・10のソロで積立は tables.js の既定値) ----
const OPT = { minUnit: 100, feeBp: 100, jackpotBp: 200, jpRank: 10 };
function rules(seats) {
  const s = normSettings({ seats }, null, OPT.minUnit, 1);
  return { s, cfg: { seats: s.seats, ante: s.ante, minBet: s.minBet, limit: s.limit, limitType: s.limitType, maxBets: s.maxBets, reserve: s.reserve, upEnabled: s.upEnabled, upLimit: s.upLimit, upLimitType: s.upLimitType, gameMaxBets: s.gameMaxBets, gameMaxUps: s.gameMaxUps, upResetOnOya: s.upResetOnOya, shugiMul: s.shugiMul, jpRank: OPT.jpRank, minUnit: OPT.minUnit, startPts: s.ante + s.reserve + s.limit },
    minChips: s.ante + s.reserve + s.limit };   // 持ち込みの最低(tables.js の join と同じ)
}

// ---- 戦略: 数の組(遺伝子)。強さ = 手札が、残っている相手全員に勝つ見込み(0〜1) ----
const GENES = [
  ['betT', 0, 1, '親: この強さ以上ならベット'],
  ['betS0', 0, 1, '親: ベット額の基本(0=最低・1=上限)'],
  ['betS1', -2, 4, '親: 強さが基準を超えた分だけ額を増やす割合'],
  ['bluff', 0, 0.5, '親: 弱くてもベットする確率(はったり)'],
  ['showT', 0, 1, '親: 2人のとき、この強さ以上なら勝負'],
  ['callA', 0, 1, '子: ついていく基準の強さ(基本)'],
  ['callB', 0, 3, '子: 払う額が場に比べて大きいほど基準を上げる割合'],
  ['upCall', -0.3, 0.3, '子: アップについていく基準に足す数'],
  ['upT', 0, 1, 'ビキ: この強さ以上ならアップ'],
  ['upS', 0, 1, 'ビキ: アップ額(0=最低・1=上限)'],
  ['nag', 0, 1, '流し(6・4)の手を、この強さとして扱う'],
  ['joinR', 0, 10, '流しの次: 場 ÷ 払う額 がこれ以上なら入る'],
];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const randomGenes = () => Object.fromEntries(GENES.map(([k, lo, hi]) => [k, lo + Math.random() * (hi - lo)]));
function child(a, b) {   // 2つの親から1つずつ選び(交叉)、少しずらす(突然変異)
  const x = {};
  for (const [k, lo, hi] of GENES) { let v = Math.random() < 0.5 ? a[k] : b[k]; if (Math.random() < 0.3) v += gauss() * 0.1 * (hi - lo); x[k] = clamp(v, lo, hi); }
  return x;
}
function strength(T, seat) {
  const g = T.g, h = g.hands[seat], ev = g.ev[seat];
  const v1 = Solo.strength1(h[0].n, h[1].n), k = g.active.size - 1;
  return { s: Math.pow(v1, 1 + 0.4 * Math.max(0, k - 1)), nag: ev.kind === 'nagashi' };   // 相手が多いほど下がる(engine.js の CPU と同じ見積もり)
}
function decide(x, T, req) {
  if (req.type === 'carryJoin') return req.short ? { act: 'skip' } : { act: req.pot / (req.fee + req.ante) >= x.joinR ? 'join' : 'skip' };   // 手札はまだ配られていない
  const k = strength(T, req.seat), s = k.nag ? x.nag : k.s;
  if (req.type === 'oya') {
    if (req.canBet && (s >= x.betT || Math.random() < x.bluff)) return { act: 'bet', amount: Math.round(req.minBet + (req.cap - req.minBet) * clamp(x.betS0 + x.betS1 * (s - x.betT), 0, 1)) };
    return req.canShow && s >= x.showT ? { act: 'show' } : { act: 'fold' };
  }
  const odds = req.amount / (req.pot + req.amount), need = x.callA + x.callB * odds + (req.type === 'followUp' ? x.upCall : 0);
  if (s < need) return { act: 'fold' };
  if (req.type === 'biki' && req.upCap >= req.minUp && s >= x.upT) return { act: 'follow', up: Math.round(req.minUp + (req.upCap - req.minUp) * x.upS) };
  return { act: 'follow', up: 0 };
}
// アプリの今のCPU(engine.js の cpuDecide)。流しの次の参加は、engine.js と同じく75%で入る
const appCpu = (T, req) => req.type === 'carryJoin' ? { act: !req.short && Math.random() < 0.75 ? 'join' : 'skip' } : Solo.cpuDecide(T, T.g, req);
// 比べるための決まった戦い方(抜け道の実験用)
const ARCHETYPES = {
  always_max: { betT: 0, betS0: 1, betS1: 0, bluff: 0, showT: 1, callA: 0, callB: 0, upCall: 0, upT: 0, upS: 1, nag: 1, joinR: 0 },   // 何でも上限いっぱいで押す
};

// ---- 対戦: players[i] = { play(T, req) } を座らせ、games ゲーム回す。チップが最低を切ったら持ち込みまで補充して数える ----
function newStats() { return { games: 0, nogame: 0, fold: 0, show: 0, nagashi: 0, fee: 0, cut: 0, shugiN: 0, shugi: 0, jpN: 0, jp: 0, poorN: 0, poorLoss: 0, potSum: 0, potMax: 0, carryMax: 0, chainMax: 0, rebuy: 0, hands: {} }; }
async function match(R, players, games, buyIns, st) {
  const n = players.length, T = Solo.createTable(R.cfg, { feeBp: OPT.feeBp, jpBp: OPT.jackpotBp, humans: players.map((p, i) => i) });
  T.players.forEach((p, i) => { p.pts = buyIns[i]; p.name = 'S' + i; });
  const bought = buyIns.slice(), poor = new Array(n).fill(0); let played = 0;
  const io = { human: async req => players[req.seat].play(T, req), grace: true };
  let chain = 0;
  for (let k = 0; k < games; k++) {
    T.players.forEach((p, i) => { if (p.pts < R.minChips) { const add = buyIns[i] - p.pts; p.pts += add; bought[i] += add; st.rebuy += add; } });   // ゲームの間に卓へチップを移すのと同じ
    const r = await Solo.playGame(T, io);
    if (r.type === 'nogame') { st.nogame++; continue; }
    st.games++; played++;   // 見送った人も卓にいるので、成績は卓で行われたゲームの数で割る(見送りが得に見えないように)
    // 持ち越しの場は、勝負がついた時に1回だけ数える
    if (r.type === 'win') { st[r.how]++; st.potSum += r.potGross; st.potMax = Math.max(st.potMax, r.potGross); st.fee += r.fee; st.cut += r.cut; if (r.shugi) { st.shugiN++; st.shugi += r.shugi.total; } if (r.jp) { st.jpN++; st.jp += r.jp.paid; } chain = 0; }
    else { st.nagashi++; chain++; st.chainMax = Math.max(st.chainMax, chain); st.carryMax = Math.max(st.carryMax, r.carry); }
    for (const a of r.actions) if (a.act === 'fold_poor') { st.poorN++; st.poorLoss += r.paid[a.seat] || 0; poor[a.seat] += r.paid[a.seat] || 0; }   // チップ不足で自動で降ろされ、それまでに出したチップを失った
    for (const s of r.g.parts) { const h = r.g.hands[s], c = Solo.category(h[0].n, h[1].n), e = st.hands[c] = st.hands[c] || { n: 0, delta: 0, won: 0 }; e.n++; e.delta += r.deltas[s]; if (r.winner === s) e.won++; }
    for (const p of T.players) if (p.pts < 0) throw new Error('チップがマイナスになりました: ' + JSON.stringify(T.players.map(q => q.pts)));
  }
  // 終わり: 積立のラストゲーム → 残った持ち越しは残っている人で等分(tables.js の endConditions・endTable と同じ順)
  if (T.jp.pool > 0) await Solo.playLastGame(T, {});
  if (T.pot > 0) { const ids = T.carry ? T.carry.survivors : T.players.map((p, i) => i), sh = Math.floor(T.pot / ids.length); ids.forEach((s, j) => { T.players[s].pts += sh + (j === 0 ? T.pot - sh * ids.length : 0); }); T.pot = 0; }
  const net = T.players.map((p, i) => p.pts - bought[i]);
  const gap = net.reduce((a, b) => a + b, 0) + T.feeNew;   // 勝ち負けの合計 + 運営の手数料 = 0 のはず
  if (gap !== 0) throw new Error(`チップの合計が合いません(差${gap})`);
  return { net, games: new Array(n).fill(played), poor };
}

// ---- CSV ----
const esc = v => { const t = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function appendCsv(file, header, rows) {
  const fresh = !fs.existsSync(file);
  fs.appendFileSync(file, (fresh ? '﻿' + header.join(',') + '\n' : '') + rows.map(r => r.map(esc).join(',')).join('\n') + '\n');   // 先頭の印(BOM)は、Excelで日本語が化けないため
}
function writeCsv(file, header, rows) { fs.writeFileSync(file, '﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\n') + '\n'); }
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const [head, ...lines] = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split('\n'); const keys = head.split(',');
  return lines.filter(Boolean).map(l => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v])));
}

const meanCi = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); return { m, ci: 1.96 * sd / Math.sqrt(xs.length) }; };
// 1つの戦い方を1席に座らせ、残りの席を others で埋めて何回も戦わせ、1ゲームあたりの勝ち負けを測る
async function evalSeat(R, me, others, opt, st, buyIn0) {
  const per = [], poor = [];
  for (let m = 0; m < opt.evalMatches; m++) {
    const players = [me, ...Array.from({ length: R.s.seats - 1 }, () => others)], buy = players.map((p, i) => i === 0 && buyIn0 ? buyIn0 : opt.buyin);
    const r = await match(R, players, opt.games, buy, st); per.push(r.net[0] / Math.max(1, r.games[0])); poor.push(r.poor[0] / Math.max(1, r.games[0]));
  }
  return Object.assign(meanCi(per), { poor: meanCi(poor) });
}

async function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const opt = { gens: +arg('gens', 20), games: +arg('games', 500), rounds: +arg('rounds', 4), seats: +arg('seats', 6), buyin: +arg('buyin', 5000), data: arg('data', path.join(__dirname, 'data')), fresh: argv.includes('--fresh'), evalMatches: +arg('eval', 20), log: !argv.includes('--quiet') };
  const R = rules(opt.seats); opt.seats = R.s.seats;
  if (!(opt.gens >= 1 && opt.games >= 1 && opt.rounds >= 1 && opt.evalMatches >= 2)) throw new Error('--gens・--games・--rounds は1以上、--eval は2以上にしてください');
  if (!(opt.buyin >= R.minChips)) throw new Error(`持ち込みは${R.minChips}チップ以上です`);
  fs.mkdirSync(opt.data, { recursive: true });
  const F = k => path.join(opt.data, k + '.csv'), runAt = new Date().toISOString(), say = m => opt.log && console.log(m);
  const POP = opt.seats * 2;   // 1世代 = 2卓ぶんの戦略

  // 保存した戦略を読む(なければ最初から)
  let pop = opt.fresh ? [] : readCsv(F('population')).map(r => ({ id: r.id, born: +r.born, gen: +r.gen, x: Object.fromEntries(GENES.map(([k, lo, hi]) => [k, clamp(+r[k], lo, hi)])) })).filter(p => GENES.every(([k]) => Number.isFinite(p.x[k])));
  let genNo = pop.reduce((a, p) => Math.max(a, p.gen), 0), nextId = pop.reduce((a, p) => Math.max(a, +String(p.id).slice(1) || 0), 0) + 1;
  say(pop.length ? `保存した戦略 ${pop.length}個の続きから学習します(${genNo}世代目まで済み)` : '最初から学習します');
  while (pop.length < POP) pop.push({ id: 'S' + nextId++, born: genNo + 1, x: randomGenes() });
  pop = pop.slice(0, POP);
  const total = newStats();

  for (let gi = 0; gi < opt.gens; gi++) {
    genNo++;
    const sum = new Map(pop.map(p => [p, { net: 0, games: 0 }]));
    for (let r = 0; r < opt.rounds; r++) {   // 席を組み替えて、全員が全員と戦うようにする
      const order = pop.slice().sort(() => Math.random() - 0.5);
      for (let t = 0; t < order.length; t += opt.seats) {
        const seat = order.slice(t, t + opt.seats), res = await match(R, seat.map(p => ({ play: (T, q) => decide(p.x, T, q) })), opt.games, seat.map(() => opt.buyin), total);
        seat.forEach((p, i) => { sum.get(p).net += res.net[i]; sum.get(p).games += res.games[i]; });
      }
    }
    pop.forEach(p => { const s = sum.get(p); p.fit = s.net / Math.max(1, s.games); p.games = s.games; p.gen = genNo; });
    pop.sort((a, b) => b.fit - a.fit);
    const fits = pop.map(p => p.fit), best = pop[0];
    appendCsv(F('history'), ['run_at', 'gen', 'games_per_strategy', 'best_id', 'best_per_game', 'mean_per_game', 'worst_per_game', ...GENES.map(g => 'best_' + g[0])],
      [[runAt, genNo, best.games, best.id, best.fit, fits.reduce((a, b) => a + b, 0) / fits.length, fits[fits.length - 1], ...GENES.map(([k]) => best.x[k])]]);
    say(`世代${genNo}: 一番 ${best.id} 1ゲームあたり ${best.fit.toFixed(1)}チップ / 平均 ${(fits.reduce((a, b) => a + b, 0) / fits.length).toFixed(1)}`);
    if (gi === opt.gens - 1) break;   // 最後の世代は、成績をつけたまま保存する
    const keep = pop.slice(0, POP / 2), pick = () => { const a = keep[Math.floor(Math.random() * keep.length)], b = keep[Math.floor(Math.random() * keep.length)]; return keep.indexOf(a) < keep.indexOf(b) ? a : b; };
    pop = [...keep, ...Array.from({ length: POP - keep.length }, () => ({ id: 'S' + nextId++, born: genNo + 1, x: child(pick().x, pick().x) }))];
  }
  writeCsv(F('population'), ['id', 'born', 'gen', 'per_game', 'games', ...GENES.map(g => g[0])], pop.map(p => [p.id, p.born, p.gen, p.fit ?? '', p.games ?? '', ...GENES.map(([k]) => p.x[k])]));

  // ---- 実験: 一番の戦略は、アプリのCPUや決まった戦い方に勝てるか。チップの少ない人は不利か ----
  const best = pop[0], bestP = { play: (T, q) => decide(best.x, T, q) }, ex = newStats();
  const vsCpu = await evalSeat(R, bestP, { play: appCpu }, opt, ex);
  const cpuSelf = await evalSeat(R, { play: appCpu }, { play: appCpu }, opt, ex);
  const maniac = await evalSeat(R, { play: (T, q) => decide(ARCHETYPES.always_max, T, q) }, bestP, opt, ex);
  const short = await evalSeat(R, bestP, bestP, opt, ex, R.minChips);   // 自分だけ持ち込みが最低(補充も最低まで)。ほかは同じ戦略で持ち込み多め
  const maxP = { play: (T, q) => decide(ARCHETYPES.always_max, T, q) };   // 大きく賭け続ける卓で、チップ不足で降ろされて失う分(持ち込み最低と多めで比べる)
  const poorLo = await evalSeat(R, bestP, maxP, opt, ex, R.minChips), poorHi = await evalSeat(R, bestP, maxP, opt, ex);
  appendCsv(F('progress'), ['run_at', 'gen', 'best_id', 'vs_app_cpu_per_game', 'ci95', 'games'], [[runAt, genNo, best.id, vsCpu.m, vsCpu.ci, opt.evalMatches * opt.games]]);
  say(`一番の戦略 ${best.id} vs アプリのCPU: 1ゲームあたり ${vsCpu.m.toFixed(1)} ± ${vsCpu.ci.toFixed(1)}チップ`);

  const g = total.games, wins = total.fold + total.show, rep = [];
  const add = (section, name, value, note) => rep.push([runAt, genNo, section, name, value, note || '']);
  add('学習', '世代の数(累計)', genNo); add('学習', '学習で回したゲーム', g); add('学習', 'うち参加者が2人未満で始まらなかった回', total.nogame);
  add('結果の割合', '全員が降りて決まった', total.fold / g); add('結果の割合', '勝負で決まった', total.show / g); add('結果の割合', '流し(持ち越し)', total.nagashi / g);
  add('場', '勝負がついた場の平均', total.potSum / Math.max(1, wins), '持ち越し分を含む'); add('場', '一番大きな場', total.potMax); add('場', '持ち越しの一番大きな場', total.carryMax); add('場', '流しが続いた最多回数', total.chainMax);
  add('手数料', '運営 1ゲームあたり', total.fee / g); add('手数料', '積立 1ゲームあたり', total.cut / g);
  add('手数料', '運営の手数料 ÷ 動いた場', total.fee / Math.max(1, total.potSum), '持ち越しの場は勝負がついた時にまとめてかかる');
  add('祝儀・積立', '祝儀が出た割合', total.shugiN / g); add('祝儀・積立', '祝儀 1回の平均', total.shugi / Math.max(1, total.shugiN));
  add('祝儀・積立', 'ジャックポットが出た割合', total.jpN / g); add('祝儀・積立', 'ジャックポット 1回の平均', total.jp / Math.max(1, total.jpN));
  add('チップ不足', '自動で降ろされた回数 1ゲームあたり', total.poorN / g, 'オールインがないため、払えない額を賭けられると、それまでに出した分を失って降りる');
  add('チップ不足', '自動で降ろされて失ったチップ 1回の平均', total.poorLoss / Math.max(1, total.poorN));
  add('実験', '一番の戦略 vs アプリのCPU(1ゲームあたり)', vsCpu.m, `95%の幅 ±${vsCpu.ci.toFixed(1)}`);
  add('実験', 'アプリのCPU vs アプリのCPU(基準)', cpuSelf.m, `95%の幅 ±${cpuSelf.ci.toFixed(1)}。手数料のぶん少しマイナスになるのが普通`);
  add('実験', '上限いっぱいで押し続ける人 vs 一番の戦略5人', maniac.m, `95%の幅 ±${maniac.ci.toFixed(1)}。プラスなら、押すだけで勝てる抜け道`);
  add('実験', `持ち込み${R.minChips}(最低)の人 vs 持ち込み${opt.buyin}の人(同じ戦略)`, short.m, `95%の幅 ±${short.ci.toFixed(1)}。大きくマイナスなら、チップの少ない人が構造的に不利`);
  add('実験', `上限いっぱいで押す5人の卓で、自動で降ろされて失うチップ(持ち込み${R.minChips})`, poorLo.poor.m, `1ゲームあたり。95%の幅 ±${poorLo.poor.ci.toFixed(1)}`);
  add('実験', `上限いっぱいで押す5人の卓で、自動で降ろされて失うチップ(持ち込み${opt.buyin})`, poorHi.poor.m, `1ゲームあたり。95%の幅 ±${poorHi.poor.ci.toFixed(1)}`);
  appendCsv(F('report'), ['run_at', 'gen', 'section', 'name', 'value', 'note'], rep);
  // avg_delta はそのゲームだけの勝ち負け(祝儀・ジャックポットを含む)。流しになったゲームは場が次へ持ち越されるので、持ち越した場を次で取った分は入らない
  appendCsv(F('hands'), ['run_at', 'gen', 'hand', 'count', 'share', 'win_rate', 'avg_delta', 'note'],
    Object.entries(total.hands).sort((a, b) => b[1].delta / b[1].n - a[1].delta / a[1].n).map(([h, e]) => [runAt, genNo, h, e.n, e.n / Object.values(total.hands).reduce((a, x) => a + x.n, 0), e.won / e.n, e.delta / e.n, h.startsWith('流し') ? '流しになると場は次へ持ち越され、次で取った分はここに入らないため、実際より低く出る' : '']));
  if (opt.log) for (const r of rep) console.log(`  [${r[2]}] ${r[3]}: ${typeof r[4] === 'number' ? Math.round(r[4] * 1000) / 1000 : r[4]}${r[5] ? '  (' + r[5] + ')' : ''}`);
  say(`保存しました: ${opt.data}`);
  return { best, vsCpu, total, pop };
}

module.exports = { main, decide, rules, match, GENES, readCsv };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
