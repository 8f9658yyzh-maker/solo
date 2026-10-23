'use strict';
const assert = require('node:assert');
const nodeCrypto = require('node:crypto');
const Solo = require('./engine.js');
const { evalHand, cmp, resolveShowdown } = Solo;

let passed = 0;
const ok = (name) => { passed++; console.log('  OK  ' + name); };
const section = (t) => console.log('\n■ ' + t);

/* ---------- 1. SHA-256 ---------- */
section('SHA-256（Node標準と一致するか）');
{
  const samples = ['', 'abc', 'solo|game1|red|oya0|seats0,1,2,3|ab12|1♥ 2♦ 10♠', 'あいうえお沖縄ソロ', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(1000)];
  for (const s of samples) assert.strictEqual(Solo.sha256hex(s), nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex'), 'len=' + s.length);
  for (let i = 0; i < 300; i++) { const s = nodeCrypto.randomBytes(i % 200).toString('base64'); assert.strictEqual(Solo.sha256hex(s), nodeCrypto.createHash('sha256').update(s).digest('hex')); }
  ok(`${samples.length + 300}件が一致`);
}

/* ---------- 2. 乱数と混ぜ方の偏り ---------- */
section('乱数の偏り（カイ二乗検定）');
{
  const N = 600000, c = new Array(6).fill(0);
  for (let i = 0; i < N; i++) c[Solo.randomInt(6)]++;
  const e = N / 6, chi = c.reduce((a, x) => a + (x - e) ** 2 / e, 0);
  console.log('     サイコロ chi2 =', chi.toFixed(2), '（自由度5。20.5未満なら偏りなし）');
  assert.ok(chi < 20.5); ok('randomInt(6) に偏りなし');

  const M = 200000, pos = new Array(20).fill(0), pair = {};
  const deck = Solo.makeDeck('red');
  for (let i = 0; i < M; i++) {
    const sh = Solo.shuffle(deck);
    assert.strictEqual(sh.length, 20);
    pos[sh.findIndex(x => x.n === 1 && x.s === '♥')]++;
  }
  const e2 = M / 20, chi2 = pos.reduce((a, x) => a + (x - e2) ** 2 / e2, 0);
  console.log('     シャッフル（♥1の位置） chi2 =', chi2.toFixed(2), '（自由度19。43.8未満なら偏りなし）');
  assert.ok(chi2 < 43.8); ok('shuffle の位置に偏りなし');

  const sh = Solo.shuffle(deck);
  assert.deepStrictEqual(sh.map(x => x.n + x.s).sort(), deck.map(x => x.n + x.s).sort());
  ok('shuffle は20枚の入れ替えだけ（増減なし）');
}

/* ---------- 3. 役の判定 ---------- */
section('役の判定（20枚から2枚＝190通り）');
{
  const deck = Solo.makeDeck('red');
  const hands = [];
  for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) hands.push(evalHand(deck[i].n, deck[j].n));
  assert.strictEqual(hands.length, 190);
  const cnt = k => hands.filter(h => h.kind === k).length;
  console.log('     ソロ', cnt('solo'), 'ピン', cnt('pin'), '流し', cnt('nagashi'), '豚', cnt('buta'), '点', cnt('point'));
  assert.strictEqual(cnt('solo'), 10); assert.strictEqual(cnt('pin'), 12); assert.strictEqual(cnt('nagashi'), 4);
  ok('ソロ10・ピン12・流し4 の数が合う');

  assert.strictEqual(evalHand(1, 5).label, 'ゴピン'); assert.strictEqual(evalHand(1, 9).label, 'キュウピン'); assert.strictEqual(evalHand(10, 1).label, 'ジッピン');
  assert.strictEqual(evalHand(1, 9).kind, 'pin', '1と9は豚ではなくキュウピン');
  assert.strictEqual(evalHand(6, 7).pts, 3); assert.strictEqual(evalHand(6, 9).pts, 5); assert.strictEqual(evalHand(2, 8).kind, 'buta');
  assert.strictEqual(evalHand(1, 1).label, 'エースのソロ');
  ok('あなたの例（6+7=3点、6+9=5点、2+8=豚、エースのソロ）');

  // 強さの順番
  const order = [evalHand(2, 8), evalHand(1, 2), evalHand(5, 9), evalHand(1, 8), evalHand(1, 5), evalHand(1, 9), evalHand(1, 10), evalHand(1, 1), evalHand(9, 9), evalHand(10, 10)];
  for (let i = 0; i < order.length - 1; i++) assert.strictEqual(cmp(order[i + 1], order[i]), 1, order[i].label + ' < ' + order[i + 1].label);
  ok('豚 < 3点 < 4点 < 9点 < ゴピン < キュウピン < ジッピン < 1のソロ < 9のソロ < 10のソロ');

  // 流し
  const nag = evalHand(6, 4);
  for (const h of hands) {
    const top = h.kind === 'solo' && h.rank === 10;
    assert.strictEqual(cmp(nag, h), top ? -1 : 0); assert.strictEqual(cmp(h, nag), top ? 1 : 0);
  }
  ok('6と4は、10のソロ以外に勝ちも負けもしない');

  // 反対から比べても逆の結果／推移律（流しを除く）
  const real = hands.filter(h => h.kind !== 'nagashi');
  for (const a of real) for (const b of real) assert.strictEqual(cmp(a, b) + cmp(b, a), 0);
  for (const a of real) for (const b of real) for (const c of real) if (cmp(a, b) > 0 && cmp(b, c) > 0) assert.strictEqual(cmp(a, c), 1);
  ok('比較は矛盾しない（逆転・推移）');

  assert.strictEqual(cmp(evalHand(10, 9), evalHand(7, 2)), 0); // 9点同士
  assert.strictEqual(cmp(evalHand(2, 8), evalHand(3, 7)), 0); // 豚同士
  assert.strictEqual(cmp(evalHand(1, 5), evalHand(1, 5)), 0);
  ok('同点（10と9 と 7と2、豚同士、同じピン）は流し');

  const r1 = resolveShowdown([{ seat: 0, hand: evalHand(1, 5) }, { seat: 1, hand: evalHand(6, 4) }, { seat: 2, hand: evalHand(9, 8) }]);
  assert.strictEqual(r1.type, 'nagashi'); assert.deepStrictEqual(r1.candidates, [1]);
  const r2 = resolveShowdown([{ seat: 0, hand: evalHand(10, 10) }, { seat: 1, hand: evalHand(6, 4) }]);
  assert.strictEqual(r2.type, 'win'); assert.strictEqual(r2.winner, 0);
  const r3 = resolveShowdown([{ seat: 0, hand: evalHand(3, 6) }, { seat: 1, hand: evalHand(2, 7) }, { seat: 2, hand: evalHand(1, 2) }]);
  assert.strictEqual(r3.type, 'nagashi'); assert.deepStrictEqual(r3.candidates, [0, 1]);
  const r4 = resolveShowdown([{ seat: 0, hand: evalHand(3, 6) }, { seat: 1, hand: evalHand(1, 9) }, { seat: 2, hand: evalHand(2, 7) }]);
  assert.strictEqual(r4.type, 'win'); assert.strictEqual(r4.winner, 1);
  ok('勝負の決着（6・4を含む場合、10のソロが勝つ場合、同点、ピンが点数に勝つ場合）');

  const probs = Solo.categoryProbabilities();
  assert.ok(Math.abs(probs['ソロ'] - 10 / 190) < 1e-12);
  ok('理論値：ソロ ' + (probs['ソロ'] * 100).toFixed(2) + '%、エースのソロは ' + (100 / 190).toFixed(2) + '%');
}

/* ---------- 4. 台本つきの試合 ---------- */
function scripted(list) {
  const seen = [];
  const fn = async (req) => {
    const exp = list.shift();
    assert.ok(exp, '台本より多く質問された: ' + JSON.stringify(req));
    assert.strictEqual(req.type, exp.type, `質問の種類 期待=${exp.type} 実際=${req.type} (seat ${req.seat})`);
    assert.strictEqual(req.seat, exp.seat, `${exp.type} の席 期待=${exp.seat} 実際=${req.seat}`);
    if (exp.check) exp.check(req);
    seen.push(req);
    return exp.resp;
  };
  fn.seen = seen;
  return fn;
}
const F = { act: 'follow' }, FO = { act: 'fold' };
const total = T => T.players.reduce((a, p) => a + p.pts, 0) + T.pot;

const cfgBase = { ante: 1, limit: 10, limitType: 'perGame', maxBets: 3, minBet: 1, reserve: 0, startPts: 100 };
const allHuman = n => Array.from({ length: n }, (_, i) => i);
const round = (b, up, upc) => [
  { type: 'oya', seat: 0, resp: { act: 'bet', amount: b } },
  { type: 'follow', seat: 1, resp: F }, { type: 'follow', seat: 2, resp: F },
  { type: 'biki', seat: 3, resp: { act: 'follow', up }, check: r => { assert.strictEqual(r.amount, b); if (upc != null) assert.strictEqual(r.upCap, upc); } },
  { type: 'followUp', seat: 0, resp: F }, { type: 'followUp', seat: 1, resp: F }, { type: 'followUp', seat: 2, resp: F }
];

async function main() {
  /* ---- A ---- */
  section('台本テスト A：あなたの例（場 28チップ→ 52チップ→ 72チップ）');
  {
    const T = Solo.createTable({ ...cfgBase, seats: 4 }, { humans: allHuman(4) });
    const pots = [];
    const sc = scripted([].concat(round(3, 3, 10), round(3, 3, 7), round(1, 4, 4)));
    const io = { human: async (req) => { if (req.type === 'oya') pots.push(T.pot); return sc(req); } };
    const r = await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
    assert.deepStrictEqual(pots, [4, 28, 52], '各ラウンドの前の場: ' + pots);
    assert.strictEqual(r.type, 'win'); assert.strictEqual(r.winner, 0); assert.strictEqual(r.how, 'show');
    assert.strictEqual(r.potWon, 72);
    assert.deepStrictEqual(T.players.map(p => p.pts), [154, 82, 82, 82]);
    assert.strictEqual(total(T), 400);
    ok('場は 4 → 28 → 52 → 72チップ。親(ゴピン)が72チップ獲得（1人18チップ×4）');
    assert.strictEqual(sc.seen.length, 21);
    ok('ビキの上乗せ上限は 10 → 7 → 4（1ゲーム型で、使った分だけ減る）');
  }

  /* ---- B ---- */
  section('台本テスト B：親が代わる例（場114チップ・流し・再参加40チップ）');
  let TB;
  {
    const T = TB = Solo.createTable({ ...cfgBase, seats: 4 }, { humans: allHuman(4) });
    const snaps = [];
    const sc = scripted([
      { type: 'oya', seat: 0, resp: { act: 'bet', amount: 5 } },
      { type: 'follow', seat: 1, resp: F }, { type: 'follow', seat: 2, resp: F },
      { type: 'biki', seat: 3, resp: { act: 'follow', up: 10 }, check: r => assert.strictEqual(r.upCap, 10) },
      { type: 'followUp', seat: 0, resp: FO },              // 親が降りる
      { type: 'followUp', seat: 1, resp: F }, { type: 'followUp', seat: 2, resp: F },
      { type: 'oya', seat: 1, resp: { act: 'bet', amount: 10 }, check: r => { assert.strictEqual(r.cap, 10); assert.strictEqual(r.betsLeft, 3); } }, // 新しい親は3回・上限リセット
      { type: 'follow', seat: 2, resp: F },
      { type: 'biki', seat: 3, resp: { act: 'follow', up: 10 }, check: r => assert.strictEqual(r.upCap, 10) }, // ビキの上限もリセット
      { type: 'followUp', seat: 1, resp: F }, { type: 'followUp', seat: 2, resp: F }
    ]);
    const io = { human: async (req) => sc(req), log: () => {}, sync: () => { } };
    const origPot = () => T.pot;
    const r = await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 2], 1: [3, 6], 2: [2, 7], 3: [1, 8] } });
    assert.strictEqual(r.type, 'nagashi'); assert.strictEqual(r.reason, 'tie');
    assert.deepStrictEqual(r.candidates, [1, 2, 3]);
    assert.strictEqual(T.pot, 114, '場は 6 + 36×3 = 114');
    assert.strictEqual(T.carry.fee, 40, '36チップの10%増し = 39.6 → 40チップ');
    assert.deepStrictEqual(T.players.map(p => p.pts), [94, 64, 64, 64]);
    assert.strictEqual(total(T), 400);
    ok('場114チップ（前の親6チップ+ 残り3人が36チップずつ）、再参加は 36×1.1=39.6 → 40チップ');
    assert.ok([1, 2, 3].includes(T.nextOya)); ok('次の親は同点の3人からサイコロで決まる');
    assert.strictEqual(T.color, 'red'); ok('流しでは色は変わらない');
  }
  {
    // 続きのゲーム：降りた席0は40チップを払って参加する。全員が降りて最後の1人が勝つ。
    const T = TB; let askedFee = null;
    const io = { human: async (req) => { if (req.type === 'oya') return FO; if (req.type === 'carryJoin') return { act: 'join' }; throw new Error('想定外: ' + req.type); } };
    const before0 = T.players[0].pts;
    const r = await Solo.playGame(T, io);
    assert.strictEqual(r.type, 'win'); assert.strictEqual(r.how, 'fold');
    const k = r.g.parts.length, ante = T.cfg.ante; assert.strictEqual(r.potWon, 114 + 40 + ante * k, '持ち越し114 + 再参加40 + 参加する全員の参加料');
    assert.strictEqual(T.pot, 0); assert.strictEqual(T.carry, null);
    assert.strictEqual(total(T), 400);
    assert.strictEqual(r.deltas[0], r.winner === 0 ? 114 + ante * (k - 1) : -(40 + ante), '席0は40チップと参加料を払い、勝てば場をすべて受け取る');
    ok('持ち越し114チップ+ 再参加40チップ+ 全員の参加料 を勝者が受け取る。チップ合計は常に400');
  }

  /* ---- C ---- */
  section('台本テスト C：ビキが降りて別の人がビキになる（1回の上限が4チップ）');
  {
    const T = Solo.createTable({ ante: 1, limit: 4, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 0, startPts: 100, seats: 4 }, { humans: allHuman(4) });
    const sc = scripted([
      { type: 'oya', seat: 0, resp: { act: 'bet', amount: 1 } },
      { type: 'follow', seat: 1, resp: F }, { type: 'follow', seat: 2, resp: F },
      { type: 'biki', seat: 3, resp: FO },                                           // 元のビキが降りる
      { type: 'oya', seat: 0, resp: { act: 'bet', amount: 2 }, check: r => assert.strictEqual(r.betsLeft, 2) },
      { type: 'follow', seat: 1, resp: F },
      { type: 'biki', seat: 2, resp: { act: 'follow', up: 4 }, check: r => assert.strictEqual(r.upCap, 4) }, // 新ビキ。1回4チップまで
      { type: 'followUp', seat: 0, resp: F }, { type: 'followUp', seat: 1, resp: F },
      { type: 'oya', seat: 0, resp: { act: 'bet', amount: 1 } },
      { type: 'follow', seat: 1, resp: F },
      { type: 'biki', seat: 2, resp: { act: 'follow', up: 4 }, check: r => assert.strictEqual(r.upCap, 4) },
      { type: 'followUp', seat: 0, resp: F }, { type: 'followUp', seat: 1, resp: F }
    ]);
    const io = { human: async (req) => sc(req) };
    const r = await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [4, 5], 1: [2, 3], 2: [1, 2], 3: [8, 9] } });
    assert.strictEqual(r.type, 'win'); assert.strictEqual(r.winner, 0);
    assert.strictEqual(total(T), 400);
    ok('新しいビキが使えるアップは残り2回 × 4チップ= 最高8チップ（あなたの説明どおり）');
  }

  /* ---- D ---- */
  section('台本テスト D・E：祝儀と色の交代');
  {
    const T = Solo.createTable({ ante: 1, limit: 3, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 10, startPts: 100, seats: 3 }, { humans: allHuman(3) });
    const rd = [{ type: 'oya', seat: 0, resp: { act: 'bet', amount: 1 } }, { type: 'follow', seat: 1, resp: F }, { type: 'biki', seat: 2, resp: { act: 'follow', up: 0 } }];
    const sc = scripted([].concat(rd, rd, rd));
    const r = await Solo.playGame(T, { human: async (req) => sc(req) }, { oya: 0, fixedHands: { 0: [10, 10], 1: [1, 5], 2: [9, 8] } });
    assert.strictEqual(r.type, 'win'); assert.strictEqual(r.winner, 0); assert.ok(r.shugi);
    assert.strictEqual(r.shugi.total, 20); assert.strictEqual(r.flipped, true);
    assert.strictEqual(T.color, 'black');
    assert.deepStrictEqual(T.players.map(p => p.pts), [128, 86, 86]);
    assert.strictEqual(total(T), 300);
    ok('10のソロで勝つと、降りていない人から10チップずつ（合計20チップ）。次の山札は黒に交代');
  }
  {
    const T = Solo.createTable({ ante: 1, limit: 3, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 10, startPts: 100, seats: 3 }, { humans: allHuman(3) });
    const sc = scripted([{ type: 'oya', seat: 0, resp: { act: 'bet', amount: 3 } }, { type: 'follow', seat: 1, resp: FO }, { type: 'biki', seat: 2, resp: FO }]);
    const r = await Solo.playGame(T, { human: async (req) => sc(req) }, { oya: 0, fixedHands: { 0: [10, 10], 1: [1, 5], 2: [9, 8] } });
    assert.strictEqual(r.how, 'fold'); assert.strictEqual(r.shugi, null); assert.strictEqual(T.color, 'red');
    assert.deepStrictEqual(T.players.map(p => p.pts), [102, 99, 99]);
    ok('全員が降りて勝った場合は手札を見せないので、祝儀も色の交代もなし');
  }
  {
    const T = Solo.createTable({ ante: 1, limit: 3, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 10, startPts: 100, seats: 4 }, { humans: allHuman(4) });
    const r = await Solo.playGame(T, {
      human: async (req) => { if (req.type === 'oya') return { act: 'bet', amount: 1 }; if (req.type === 'biki') return { act: 'follow', up: 0 }; return F; }
    }, { oya: 0, fixedHands: { 0: [8, 8], 1: [2, 3], 2: [1, 5], 3: [9, 7] } });
    assert.strictEqual(r.shugi.rank, 8); assert.strictEqual(r.shugi.total, 24); assert.strictEqual(T.color, 'red');
    ok('8のソロは 8チップ×3人 = 24チップ。色は変わらない');
  }

  /* ---- F: チップ不足の自動降り ---- */
  section('台本テスト F：チップ不足は自動で降りる');
  {
    const T = Solo.createTable({ ante: 1, limit: 3, limitType: 'perBet', maxBets: 3, minBet: 1, reserve: 10, startPts: 100, seats: 3 }, { humans: allHuman(3) });
    T.players[1].pts = 12; // 参加料1を払うと使えるのは1チップだけ
    const sc = scripted([{ type: 'oya', seat: 0, resp: { act: 'bet', amount: 3 } }, { type: 'biki', seat: 2, resp: FO }]);
    const r = await Solo.playGame(T, { human: async (req) => sc(req) }, { oya: 0, fixedHands: { 0: [4, 5], 1: [2, 3], 2: [1, 2] } });
    assert.strictEqual(r.type, 'win'); assert.ok(T.players.every(p => p.pts >= 0));
    ok('席1は3チップについていけないので、質問されずに自動で降りた');
  }

  /* ---- G: CPUだけで大量に遊ばせる ---- */
  section('CPU同士で大量に遊ばせて、決まりが崩れないか確認');
  const cfgs = [
    { seats: 2 }, { seats: 3 }, { seats: 4 }, { seats: 6 }, { seats: 10 },
    { seats: 4, limitType: 'perGame', limit: 10 }, { seats: 5, limitType: 'perGame', limit: 30, ante: 5 },
    { seats: 4, limit: 10, maxBets: 5 }, { seats: 3, ante: 2, limit: 6, minBet: 2 }, { seats: 4, limit: 3, reserve: 0 }
  ];
  let games = 0;
  for (const c of cfgs) {
    const T = Solo.createTable(c, { humans: [] });
    const cnt = { fold: 0, show: 0, nagashi: 0, nogame: 0, solo10: 0, flips: 0, shugi: 0 };
    let potSum = 0, colorBefore;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      colorBefore = T.color;
      const r = await Solo.playGame(T, {});
      if (r.type === 'nogame') { cnt.nogame++; continue; }
      games++;
      for (const p of T.players) assert.ok(p.pts >= 0, '負のチップ');
      assert.strictEqual(total(T), T.cfg.seats * T.cfg.startPts + T.injected, 'チップ合計が変わった');
      if (r.type === 'nagashi') { cnt.nagashi++; assert.ok(T.pot > 0 && T.carry); assert.ok(r.candidates.length >= 1); assert.ok(T.carry.survivors.length >= 2); }
      else {
        cnt[r.how]++; assert.strictEqual(T.pot, 0); assert.strictEqual(T.carry, null); potSum += r.potWon;
        if (r.shugi) cnt.shugi++;
        if (r.how === 'show' && r.hand.kind === 'solo' && r.hand.rank === 10) { cnt.solo10++; assert.notStrictEqual(T.color, colorBefore); cnt.flips++; }
        else assert.strictEqual(T.color, colorBefore);
        if (r.how === 'fold') assert.strictEqual(r.shugi, null);
      }
      for (const s of T.g.parts) assert.ok(T.g.paid[s] >= 0);
    }
    const done = cnt.fold + cnt.show + cnt.nagashi;
    const pc = x => (100 * x / done).toFixed(1).padStart(5) + '%';
    console.log(`     ${String(c.seats).padStart(2)}人 ${(c.limitType === 'perGame' ? '1ゲーム' : '1回ごと').padEnd(4)} 降り勝ち${pc(cnt.fold)} 勝負${pc(cnt.show)} 流し${pc(cnt.nagashi)} 10ソロ${cnt.solo10}回 平均の場${(potSum / Math.max(1, cnt.fold + cnt.show)).toFixed(1)}チップ参加不足${cnt.nogame}`);
    assert.ok(done > N * 0.9);
  }
  ok(`${games}ゲームで、チップの合計・マイナス・場の持ち越し・色の交代がすべて正しい`);

  console.log(`\n全${passed}項目 合格`);
}
main().catch(e => { console.error('\nNG 失敗:', e.message); console.error(e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });
