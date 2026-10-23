'use strict';
const assert = require('node:assert');
const Solo = require('./engine.js');
let passed = 0; const ok = n => { passed++; console.log('  OK  ' + n); };
function mk(cfg, n, pts) {
  const T = Solo.createTable(Object.assign({ seats: n, startPts: pts, ante: 1, limit: 3, maxBets: 3, reserve: 10 }, cfg), { humans: Array.from({ length: n }, (_, i) => i) });
  T.players.forEach((p, i) => { p.name = 'ABCDEFGH'[i]; p.pts = pts; });
  return T;
}
const total = T => T.players.reduce((a, p) => a + p.pts, 0) + T.pot;
const game1 = async T => {   // Cは1回目で降り、Bが6と4 → 流し
  let round = 0;
  const io = { human: async req => {
    if (req.type === 'oya') { round++; return { act: 'bet', amount: 10 }; }
    if (req.type === 'follow' && req.seat === 2 && round === 1) return { act: 'fold' };
    if (req.type === 'biki') return { act: 'follow', up: 0 };
    return { act: 'follow' };
  } };
  return Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [6, 4], 2: [7, 8], 3: [9, 10] } });
};
const mkCarry = () => mk({ upEnabled: true, limit: 10, limitType: 'perBet', minBet: 1, reserve: 10 }, 4, 1000);
(async () => {
  // (1) 足りない人は「払える分だけ」では参加できない。猶予を使って、戻らなければ不参加
  for (const mode of ['none', 'topup', 'skip']) {
    const T = mkCarry();
    const r1 = await game1(T); assert.strictEqual(r1.type, 'nagashi'); assert.strictEqual(r1.fee, 35);
    T.players[2].pts = 10 + 20;   // Cは使えるのが20チップ。必要は 35+1=36チップ
    const base = total(T);
    let asked = null;
    const io = { grace: true, human: async req => {
      if (req.type === 'carryJoin') {
        asked = req;
        if (mode === 'topup') { T.players[2].pts += 100; return { act: 'join' }; }
        if (mode === 'none') return { act: 'join' };   // 足していないのに「参加」を押しても入れない
        return { act: 'skip' };
      }
      if (req.type === 'oya') return { act: 'bet', amount: 1 };
      return { act: 'fold' };
    } };
    const r = await Solo.playGame(T, io);
    assert.ok(asked && asked.short && asked.need === 36 && asked.have === 20, '足りない人には猶予つきの確認');
    assert.strictEqual(r.g.parts.includes(2), mode === 'topup');
    if (mode === 'topup') { assert.strictEqual(r.stake[2], 1 + 35 + 1, '前に出した1+参加費35+参加料1(前の分も含めて数える)'); }
    else { assert.ok(r.stake[2] === 1 || r.stake[2] === undefined || r.stake[2] === 1); assert.strictEqual(T.players[2].pts, 30, '払える分だけの支払いはしない'); }
    assert.strictEqual(total(T) - 100 * (mode === 'topup' ? 1 : 0), base);
  }
  ok('参加費が足りない人は「払える分だけ」では入れない。猶予中にチップを足して戻れば参加、戻らなければ不参加(払わない)');
  // (2) 残っていた人が参加料(1回目と同じ)を払えない場合も、同じ扱い。場に出した分は場に残る
  {
    const T = mkCarry();
    await game1(T); const pot = T.pot;
    T.players[0].pts = 10;   // Aは参加料も払えない
    const before = total(T);
    let asked = null;
    const io = { grace: true, human: async req => {
      if (req.type === 'carryJoin') { asked = req; return { act: 'skip' }; }
      if (req.type === 'oya') return { act: 'bet', amount: 1 };
      return { act: 'fold' };
    } };
    const r = await Solo.playGame(T, io);
    assert.ok(asked.survivor && asked.need === 1 && asked.seat === 0);
    assert.ok(!r.g.parts.includes(0));
    assert.ok(r.potWon >= pot, '場に出したチップは戻らず、勝った人のものになる');
    assert.strictEqual(T.players[0].pts, 10);
    assert.strictEqual(total(T), before);
    ok('残っていた人が参加料を払えない場合も不参加。出したチップは場に残り、本人には戻らない');
  }
  // (3) 練習などで猶予がない場合は、足りない人に確認せず不参加
  {
    const T = mkCarry(); await game1(T); T.players[2].pts = 30;
    let asked = false;
    const io = { human: async req => { if (req.type === 'carryJoin' && req.seat === 2) asked = true; if (req.type === 'oya') return { act: 'bet', amount: 1 }; return { act: 'fold' }; } };
    const r = await Solo.playGame(T, io);
    assert.ok(!asked && !r.g.parts.includes(2)); ok('猶予のない場面では、足りない人は確認なしで不参加');
  }
  // (4) 毎ゲームの「払った合計」: 流し・勝ちの両方で出る
  {
    const T = mkCarry();
    const r1 = await game1(T);
    assert.strictEqual(r1.paid[0], 31); assert.strictEqual(r1.paid[2], 1); assert.strictEqual(r1.stake[0], 31);
    assert.strictEqual(Object.values(r1.paid).reduce((a, b) => a + b, 0), T.pot, '払った合計 = 場');
    ok('毎ゲーム、人ごとの「払ったチップの合計」が結果に入る(流しでも)');
  }
  // (6) 足りない人が複数いても、順番ではなく同時に聞く(同じ猶予の中で決める)
  {
    const T = mkCarry(); await game1(T);
    T.players[2].pts = 30; T.players[0].pts = 10;   // Cは参加費が足りず、Aは参加料も払えない
    const started = []; let open = 0, maxOpen = 0;
    const io = { grace: true, human: async req => {
      if (req.type === 'carryJoin' && req.short) { started.push(req.seat); open++; maxOpen = Math.max(maxOpen, open); await new Promise(r => setTimeout(r, 30)); open--; return { act: 'skip' }; }
      if (req.type === 'oya') return { act: 'bet', amount: 1 };
      return { act: 'fold' };
    } };
    await Solo.playGame(T, io);
    assert.ok(started.length >= 2 && maxOpen >= 2, '同時に聞いている: ' + started + ' max=' + maxOpen);
    ok('足りない人が複数いるときは、順番ではなく同時に聞く');
  }
  // (7) ゲームのデータ: 人の動きと、勝負した人のカードが結果に入る(降りた人のカードは入らない)
  {
    const T = mk({ upEnabled: true, limit: 10, limitType: 'perBet', minBet: 1, reserve: 10 }, 4, 1000);
    const io = { human: async req => req.type === 'oya' ? { act: 'bet', amount: 5 } : req.type === 'biki' ? { act: 'follow', up: 0 } : req.seat === 2 ? { act: 'fold' } : { act: 'follow' } };
    const r = await Solo.playGame(T, io, { oya: 0 });
    assert.ok(r.actions.some(a => a.act === 'bet') && r.actions.some(a => a.act === 'fold' && a.seat === 2));
    assert.ok(r.showdown.length >= 2 && !r.showdown.some(x => x.seat === 2), '降りたCのカードは入らない');
    assert.ok(r.showdown.every(x => x.hand.length === 2 && x.label));
    ok('結果に「人の動き」と「勝負した人のカード」が入る。降りた人のカードは入らない');
  }
  // (5) 3000ゲームの保存則(足りない人が混ざる)
  {
    const T = Solo.createTable({ seats: 6, startPts: 400, upEnabled: true, limit: 50, ante: 5, reserve: 10 }, { humans: [] });
    const before = total(T);
    for (let i = 0; i < 3000; i++) { await Solo.playGame(T, {}); assert.ok(T.players.every(p => p.pts >= 0)); assert.strictEqual(total(T) - T.injected, before, 'game' + i); }
    ok('3000ゲーム 保存則(少ないチップで流し・不足が頻繁に起きる設定)');
  }
  console.log('\n全' + passed + '項目 合格');
})().catch(e => { console.error(e); process.exit(1); });
