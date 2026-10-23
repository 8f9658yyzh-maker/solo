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

(async () => {
  // 例: A(親) B C D(ビキ)。Aがベット、B C D がコール、Dがアップ、A B C がコール。これを3回。
  {
    const T = mk({ upEnabled: true }, 4, 1000);
    const asks = [];
    const io = { human: async (req) => {
      asks.push(req.type + ':' + T.players[req.seat].name + ':' + req.amount);
      if (req.type === 'oya') return { act: 'bet', amount: 2 };
      if (req.type === 'follow' || req.type === 'followUp') return { act: 'follow' };
      if (req.type === 'biki') return { act: 'follow', up: 1 };
    } };
    const before = total(T);
    const r = await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
    const oyaAsks = asks.filter(a => a.startsWith('oya')).length;
    const follows = asks.filter(a => a.startsWith('follow:B') || a.startsWith('follow:C')).length;
    const ups = asks.filter(a => a.startsWith('followUp:')).length;
    assert.strictEqual(oyaAsks >= 3, true);
    assert.strictEqual(asks.filter(a => a.startsWith('biki:D')).length, 3, 'ビキは3回');
    assert.strictEqual(follows, 6, 'B,Cのベットへのコールは各3回=6');
    assert.strictEqual(ups, 9, 'アップへのコール A,B,C ×3回=9');
    // B,Cのコール回数: ベット側3 + アップ側3 = 最大6
    const perPlayer = {};
    asks.forEach(a => { const [t, who] = a.split(':'); if (t === 'follow' || t === 'followUp') perPlayer[who] = (perPlayer[who] || 0) + 1; });
    assert.strictEqual(perPlayer.B, 6); assert.strictEqual(perPlayer.C, 6); assert.strictEqual(perPlayer.A, 3);
    assert.strictEqual(total(T), before, '合計不変');
    ok('A/B/C/Dの例: 親3ベット、ビキ3アップ、B・Cは最大6回コール、親もアップを受ける、合計不変');
  }
  // かいとさんの例(2026-10-13): 1回目 A→B→C→D(コール)→Dアップ→A,B,Cコール / 2回目 Dが降りて終了 / 3回目 Dが降りたのでビキはC、Cがコールしてアップ→A,Bコール
  {
    const T = mk({ upEnabled: true, limit: 100, minBet: 2 }, 4, 1000);
    const seq = []; let round = 0;
    const io = { human: async (req) => {
      const w = T.players[req.seat].name;
      if (req.type === 'oya') { round++; seq.push(`R${round}:oya${w}`); return { act: 'bet', amount: 2 }; }
      if (req.type === 'follow') { seq.push(`${w}:call`); return { act: 'follow' }; }
      if (req.type === 'biki') { if (round === 2 && w === 'D') { seq.push(`${w}:fold`); return { act: 'fold' }; } seq.push(round === 2 ? `${w}:call` : `${w}:call+up`); return { act: 'follow', up: round === 2 ? 0 : 5 }; }
      if (req.type === 'followUp') { seq.push(`${w}:callUp`); return { act: 'follow' }; }
      seq.push('??'); return { act: 'fold' };
    } };
    const before = total(T);
    await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
    assert.strictEqual(seq.join(' '), 'R1:oyaA B:call C:call D:call+up A:callUp B:callUp C:callUp R2:oyaA B:call C:call D:fold R3:oyaA B:call C:call+up A:callUp B:callUp');
    assert.strictEqual(total(T), before);
    ok('かいとさんの例: 2回目でビキDが降りたらアップなしで終了 / 3回目はCがビキになり、1回だけアップ');
  }
  // アップに対して、降りていない全員が降りてもよい(ビキの勝ち・手札は見せない)
  {
    const T = mk({ upEnabled: true, limit: 100, minBet: 2 }, 4, 1000);
    const io = { human: async (req) => req.type === 'oya' ? { act: 'bet', amount: 2 } : req.type === 'biki' ? { act: 'follow', up: 5 } : req.type === 'followUp' ? { act: 'fold' } : { act: 'follow' } };
    const before = total(T);
    const r = await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
    assert.strictEqual(r.how, 'fold'); assert.strictEqual(total(T), before); assert.ok(T.players[3].pts > 1000);
    ok('ビキのアップに全員が降りてもよい(ビキが場を取る・合計不変)');
  }
  // ビキのアップ上限: 「1回ごと100」と「アップ合計1000」(親のベット上限とは別に決める)
  {
    const run = async (cfg, bikiScript) => {
      const T = mk(Object.assign({ upEnabled: true, limit: 50, limitType: 'perBet', minBet: 2 }, cfg), 4, 5000);
      const caps = []; let round = 0; const before = total(T);
      const io = { human: async (req) => {
        const w = T.players[req.seat].name;
        if (req.type === 'oya') { round++; return { act: 'bet', amount: 2 }; }
        if (req.type === 'biki') { caps.push(w + ':' + req.upCap); return bikiScript(w, round, req); }
        return req.type === 'followUp' ? { act: 'follow' } : { act: 'follow' };
      } };
      await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
      assert.strictEqual(total(T), before);
      return caps.join(' ');
    };
    // 1回ごと100: 毎回100まで
    assert.strictEqual(await run({ upLimit: 100, upLimitType: 'perBet' }, (w, r, q) => ({ act: 'follow', up: 100 })), 'D:100 D:100 D:100');
    // 合計1000: 1回で1000使うと、次はアップできない(上限切れ)
    assert.strictEqual(await run({ upLimit: 1000, upLimitType: 'perGame' }, (w, r, q) => ({ act: 'follow', up: 1000 })), 'D:1000 D:0 D:0');
    // 合計1000: 少しずつなら残りまで
    assert.strictEqual(await run({ upLimit: 1000, upLimitType: 'perGame' }, (w, r, q) => ({ act: 'follow', up: 400 })), 'D:1000 D:600 D:200');
    ok('ビキのアップ上限: 「1回ごと」と「合計」を親の上限とは別に決められる');
  }
  // かいとさんの例(上限あり): 1回目Dが1000アップ → 2回目Dが降りる → 3回目はCがビキになり、上限が新しくなって1000アップできる
  {
    const T = mk({ upEnabled: true, limit: 50, limitType: 'perBet', upLimit: 1000, upLimitType: 'perGame', minBet: 2 }, 4, 5000);
    const seen = []; let round = 0; const before = total(T);
    const io = { human: async (req) => {
      const w = T.players[req.seat].name;
      if (req.type === 'oya') { round++; return { act: 'bet', amount: 2 }; }
      if (req.type === 'biki') { seen.push(`R${round}:${w}:cap${req.upCap}`); if (round === 2 && w === 'D') return { act: 'fold' }; return { act: 'follow', up: round === 2 ? 0 : 1000 }; }
      return { act: 'follow' };
    } };
    await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
    assert.strictEqual(seen.join(' '), 'R1:D:cap1000 R2:D:cap0 R3:C:cap1000');
    assert.strictEqual(total(T), before);
    ok('ビキが変わる(D→C)と、アップの上限が新しくなる。親が同じ間、同じビキは上限を使い切ったら二度とアップできない');
  }
  // 親が変わる例: A親 → Dがアップ → Aが降りる → B親になり、ベット3回・ビキの上限が新しくなる / 通算の回数上限
  {
    const mkT = cfg => mk(Object.assign({ upEnabled: true, limit: 50, limitType: 'perBet', minBet: 2 }, cfg), 4, 5000);
    const play = async (cfg) => {
      const T = mkT(cfg); const asks = []; let aFold = true; const before = total(T);
      const io = { human: async (req) => {
        const w = T.players[req.seat].name;
        if (req.type === 'oya') { asks.push('oya' + w); return req.canShow && asks.length > 12 ? { act: 'show' } : { act: 'bet', amount: 2 }; }
        if (req.type === 'biki') { asks.push('biki' + w + ':' + req.upCap); return { act: 'follow', up: 5 }; }
        if (req.type === 'followUp' && w === 'A' && aFold) { aFold = false; asks.push('Aフォールド'); return { act: 'fold' }; }
        return { act: 'follow' };
      } };
      const r = await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
      assert.strictEqual(total(T), before);
      return { asks, r };
    };
    // 通算の制限なし: A(1回) → Bが新しく3回ベット
    let x = await play({});
    assert.strictEqual(x.asks.filter(a => a.startsWith('oyaA')).length, 1); assert.strictEqual(x.asks.filter(a => a.startsWith('oyaB')).length, 3, 'Bは新しく3回ベットできる');
    // ゲーム通算のベット回数の上限3: 親が変わっても合計3回まで → A1回 + B2回で勝負
    x = await play({ gameMaxBets: 3 });
    assert.strictEqual(x.asks.filter(a => /^oya[AB]/.test(a)).length, 3, '通算3回まで'); assert.strictEqual(x.asks.filter(a => a.startsWith('oyaB')).length, 2);
    // ゲーム通算のアップ回数の上限2: ビキが変わっても合計2回まで → 3回目のアップは上限0
    x = await play({ gameMaxUps: 2 });
    const bikiCaps = x.asks.filter(a => a.startsWith('biki')).map(a => a.split(':')[1]);
    assert.ok(bikiCaps.length >= 3 && Number(bikiCaps[0]) > 0 && Number(bikiCaps[1]) > 0 && bikiCaps.slice(2).every(c => c === '0'), 'アップは通算2回まで: ' + bikiCaps.join(','));
    ok('親が変わると新しく3回ベットできる。「ゲーム通算のベット回数」「通算のアップ回数」の上限をつける設定が効く');
  }
  // 流しの次のゲーム: 降りた人は「1人分+10%」と参加料を払って入るか、見送るかを選べる。全員が参加料を払い直す
  {
    const mkCarry = () => mk({ upEnabled: true, limit: 10, limitType: 'perBet', minBet: 1, reserve: 10 }, 4, 1000);
    const game1 = async T => {
      let round = 0;
      const io = { human: async (req) => {
        if (req.type === 'oya') { round++; return { act: 'bet', amount: 10 }; }
        if (req.type === 'follow' && req.seat === 2 && round === 1) return { act: 'fold' };   // Cは1回目で降りる
        if (req.type === 'biki') return { act: 'follow', up: 0 };
        return { act: 'follow' };
      } };
      return Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [6, 4], 2: [7, 8], 3: [9, 10] } });   // Bが6と4 → 流し
    };
    const game2 = async (T, join) => {
      let asked = null;
      const io = { human: async (req) => {
        if (req.type === 'carryJoin') { asked = req; return { act: join ? 'join' : 'skip' }; }
        if (req.type === 'oya') return { act: 'bet', amount: 1 };
        return { act: 'fold' };
      } };
      const r = await Solo.playGame(T, io);
      return { r, asked };
    };
    for (const join of [true, false]) {
      const T = mkCarry(); const before = total(T);
      const r1 = await game1(T);
      assert.strictEqual(r1.type, 'nagashi'); assert.strictEqual(T.pot, 94, '場: 3人が31ずつ + Cの参加料1'); assert.strictEqual(r1.fee, 35, '1人分31 + 10% = 35');
      const { r, asked } = await game2(T, join);
      assert.strictEqual(asked.seat, 2); assert.strictEqual(asked.fee, 35);
      assert.strictEqual(r.type, 'win');
      assert.strictEqual(r.potWon, join ? 94 + 35 + 4 + 1 : 94 + 3 + 1, join ? '持ち越し94 + Cの35 + 4人の参加料 + 親のベット1' : '持ち越し94 + 3人の参加料 + 親のベット1(Cは見送り)');
      assert.ok(join ? r.g.parts.includes(2) : !r.g.parts.includes(2));
      assert.strictEqual(total(T), before);
    }
    ok('流しの次のゲーム: 降りた人は(1人分+10%)+参加料を払って入るか、見送るかを選べる。参加する全員が参加料を払い直す');
  }
  // アップなし: ビキがいない。全員が普通にコール
  {
    const T = mk({ upEnabled: false }, 4, 1000);
    const types = new Set();
    const io = { human: async (req) => {
      types.add(req.type);
      if (req.type === 'oya') return { act: 'bet', amount: 2 };
      return { act: 'follow', up: 5 };
    } };
    const before = total(T);
    await Solo.playGame(T, io, { oya: 0, fixedHands: { 0: [1, 5], 1: [2, 3], 2: [7, 8], 3: [9, 10] } });
    assert.ok(!types.has('biki') && !types.has('followUp'), 'ビキもアップもない');
    assert.strictEqual(total(T), before);
    ok('アップなし設定: ビキもアップも出ない');
  }
  // 降り(離席の自動降り): 全員が降りる = 親の勝ち。参加料は払われる
  {
    const T = mk({}, 4, 1000);
    const io = { human: async (req) => req.type === 'oya' ? { act: 'bet', amount: 1 } : { act: 'fold' } };
    const before = total(T);
    const r = await Solo.playGame(T, io, { oya: 0 });
    assert.strictEqual(r.winner, 0); assert.strictEqual(T.players[0].pts, 1000 + 3);
    assert.strictEqual(total(T), before);
    ok('他の3人が自動で降りると、親が参加料を総取り');
  }
  // 新しい設定(ビキの上限・通算回数の上限)を混ぜた保存則
  {
    const T = Solo.createTable({ seats: 6, startPts: 20000, upEnabled: true, limit: 50, limitType: 'perGame', upLimit: 120, upLimitType: 'perGame', gameMaxBets: 4, gameMaxUps: 2, ante: 5 }, { humans: [] });
    const before = total(T);
    for (let i = 0; i < 3000; i++) { await Solo.playGame(T, {}); assert.ok(T.players.every(p => p.pts >= 0)); assert.strictEqual(total(T) - T.injected, before, 'game' + i); }
    ok('3000ゲーム 保存則(ビキ上限・通算回数上限あり、流しの参加選択つき)');
  }
  // 10万ゲームの保存則(アップあり/なし、ランダムCPU)
  for (const up of [true, false]) {
    const T = Solo.createTable({ seats: 6, startPts: 20000, upEnabled: up, limit: 50, ante: 5 }, { humans: [] });
    const before = total(T) ; let inj = 0;
    for (let i = 0; i < 3000; i++) {
      await Solo.playGame(T, {});
      assert.ok(T.players.every(p => p.pts >= 0));
      assert.strictEqual(total(T) - T.injected, before, 'game' + i);
    }
    ok(`3000ゲーム 保存則(アップ${up ? 'あり' : 'なし'})`);
  }
  console.log('\n全' + passed + '項目 合格');
})().catch(e => { console.error(e); process.exit(1); });
