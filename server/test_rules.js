'use strict';
// ルールの抜け道・設定の組み合わせの試験(2026-10-31 の点検で見つかった所の再発防止と、設定を混ぜた乱打ち)
const assert = require('node:assert');
const D = require('./db'); const { Core } = require('./core'); const { Tables, Runtime } = require('./tables'); const Solo = require('../engine.js');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const thr = (f, re) => { try { f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };
const until = async (f, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(10); } return !!f(); };

function world(optT) {
  const d = D.open(':memory:'), c = new Core(d);
  const cid = c.bootstrap('kaito', 'password-1', '09000000001');
  const mk = (by, role, name, i) => c.signup({ invite: c.createInvite(c.user(by), role).code, username: name, password: 'password-' + name, phone: '0900000' + (1000 + i), deviceId: 'dev-' + name + '-xxxx', ip: '10.0.0.' + i }).id;
  const man = mk(cid, 'manager', 'kanri', 1), aj = mk(man, 'aj', 'aj_one', 2);
  c.give(c.user(cid), man, 10000000); c.give(c.user(man), aj, 5000000);
  const ps = []; for (let i = 0; i < 6; i++) { const id = mk(aj, 'player', 'pl_' + i, 10 + i); c.give(c.user(aj), id, 200000); ps.push(id); }
  let now = Date.now();
  const T = new Tables(c, Object.assign({ turnMs: 2000, voteMs: 500, graceMs: 300, minStayMs: 0, disconnectGraceMs: 100, beatScale: 0, feeTickMs: 0, entryFee: false, feeBp: 0, jackpotBp: 0, clock: () => now }, optT || {}));
  return { d, c, T, aj, ps, tick: ms => { now += ms; return now; } };
}
// 画面の代わり: 順番が来たら decide で操作する(rid つき)
const sub = (W, rt, uid, decide) => {
  const b = { n: 0, on: true };
  b.res = { write: s => { if (!s.startsWith('data: ') || !b.on) return; const v = JSON.parse(s.slice(6)); b.last = v; if (v.req && decide && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; if (!b.on) return; const a = decide(v.req, v); if (a) try { rt.act(W.c.user(uid), Object.assign({ rid: v.req.rid }, a)); b.n++; } catch (e) {} }); } } };
  rt.subscribe(W.c.user(uid), b.res); b.stop = () => { b.on = false; rt.unsubscribe(W.c.user(uid), b.res); }; return b;
};
const randomPlay = req => { const r = Math.random(); if (req.type === 'carryJoin') return { act: r < 0.7 ? 'join' : 'skip' }; if (req.type === 'oya') return r < 0.15 ? { act: 'fold' } : r < 0.3 && req.canShow ? { act: 'show' } : { act: 'bet', amount: Math.max(req.minBet || 1, Math.floor(Math.random() * (req.cap || 1)) + 1) }; if (req.type === 'biki') return r < 0.2 ? { act: 'fold' } : { act: 'follow', up: Math.random() < 0.4 ? 1 + Math.floor(Math.random() * Math.max(1, req.upCap || 1)) : 0 }; return r < 0.25 ? { act: 'fold' } : { act: 'follow' }; };

(async () => {
  // ① 流しの次のゲームの準備中(他の人に「参加しますか」を聞いている間)は、場に残った人もチップをポケットへ戻せない
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, shugiMul: 0, leave: 'allow' }).id);
    const orig = Solo.playGame; let k0 = 0;
    Solo.playGame = (T, io, o) => { k0++; return orig(T, io, Object.assign({}, o, k0 === 1 ? { fixedHands: { 0: [6, 4], 1: [2, 3], 2: [5, 7] } } : {})); };
    try {
      for (let k = 0; k < 3; k++) await rt.join(W.c.user(W.ps[k]), 3000);
      let hold = null;
      const dec = seat => r => { if (r.type === 'carryJoin') { hold = r; return null; } if (seat === 2) return { act: 'fold' }; return r.type === 'oya' ? { act: 'bet', amount: 100 } : { act: 'follow', up: 0 }; };
      const bots = W.ps.slice(0, 3).map((uid, k) => sub(W, rt, uid, dec(k)));
      assert.ok(await until(() => hold), '流しになり、降りた人に参加を聞いている');
      const sv = rt.T.carry.survivors[0], uid = rt.seats[sv].userId;
      thr(() => rt.exchange(W.c.user(uid), 'out', rt.T.players[sv].pts), /準備中/);
      rt.act(W.c.user(rt.seats[hold.seat].userId), { act: 'join', rid: hold.rid });
      await until(() => rt.T.gameNo >= 2);
      assert.strictEqual(rt.status, 'running'); assert.ok(W.c.L.check().ok);
      bots.forEach(b => b.stop()); W.T.stop(aj, rt.id); await until(() => rt.status !== 'running');
      assert.ok(W.c.L.check().ok);
      ok('流しの次のゲームの準備中は、場に残った人もポケットへ戻せない(以前は戻せてしまい、卓がエラーで止まった)');
    } finally { Solo.playGame = orig; }
  }
  // ② 途中退席なしの卓では、チップをポケットへ戻す(勝ち逃げ)もできない
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, leave: 'deny', durationMin: 60 }).id);
    for (let k = 0; k < 2; k++) await rt.join(W.c.user(W.ps[k]), 5000);
    const u = W.c.user(W.ps[0]);
    thr(() => rt.leave(u), /途中退席/);
    await until(() => !rt.inGame, 8000);
    thr(() => rt.exchange(u, 'out', 100), /ポケットへ戻せません|準備中|ゲーム中/);
    W.T.stop(aj, rt.id); await until(() => rt.status !== 'running', 8000);
    thr(() => W.T.create(aj, 'x', { leave: 'deny', durationMin: 0 }), /時間/);
    thr(() => W.T.create(aj, 'x', { startMode: 'condition', durationMin: 0 }), /時間/);
    assert.ok(W.T.create(aj, 'x', { leave: 'allow', durationMin: 0 }));
    ok('途中退席なしの卓: 席も立てず、チップも持ち出せない。終了時間を決めないと作れない(誰も帰れない卓を作れない)');
  }
  // ③ その場にいる人が1人だけになったら一時停止(離席した人の参加料が、残った1人に流れ続けない)
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, leave: 'allow', shugiMul: 0 }).id);
    for (let k = 0; k < 3; k++) await rt.join(W.c.user(W.ps[k]), 5000);
    const b0 = sub(W, rt, W.ps[0], r => r.type === 'oya' ? { act: 'bet', amount: 100 } : r.type === 'carryJoin' ? { act: 'join' } : { act: 'follow' });
    rt.setAway(W.c.user(W.ps[1]), true); rt.setAway(W.c.user(W.ps[2]), true);
    await until(() => rt.paused && !rt.inGame);
    const g0 = rt.T.gameNo; await sleep(500);
    assert.strictEqual(rt.T.gameNo, g0); assert.ok(rt.paused);
    rt.setAway(W.c.user(W.ps[1]), false);
    const b1 = sub(W, rt, W.ps[1], r => r.type === 'oya' ? { act: 'bet', amount: 100 } : r.type === 'carryJoin' ? { act: 'join' } : { act: 'follow' });
    assert.ok(await until(() => rt.T.gameNo > g0), '2人そろうと再開');
    b0.stop(); b1.stop(); W.T.stop(aj, rt.id); await until(() => rt.status !== 'running'); assert.ok(W.c.L.check().ok);
    ok('その場にいる人が2人未満なら一時停止し、戻ると再開する');
  }
  // ④ 一時停止中は、時間がたっても参加費を引かない。止まっていても、決めた時間で終わる
  {
    const W = world({ entryFee: true }); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, leave: 'allow', durationMin: 120 }).id);
    for (let k = 0; k < 2; k++) await rt.join(W.c.user(W.ps[k]), 5000);
    for (let k = 0; k < 2; k++) { const res = { write() {} }; rt.subscribe(W.c.user(W.ps[k]), res); rt.unsubscribe(W.c.user(W.ps[k]), res); }
    assert.ok(await until(() => rt.paused && !rt.inGame));
    const before = W.c.pocket(W.ps[0]);
    for (let h = 1; h <= 3; h++) rt.feeTick(W.tick(3600000));
    assert.strictEqual(W.c.pocket(W.ps[0]), before);
    rt.startedAt = Date.now() - 121 * 60000;
    assert.ok(await until(() => rt.status === 'ended'), '止まっていても時間で終わる');
    assert.strictEqual(W.M_ = W.T.userTable.size, 0); assert.ok(W.c.L.check().ok);
    ok('全員の接続が切れて止まっている間は参加費を引かない。止まっていても終了時間で終わり、チップはポケットへ戻る');
  }
  // ⑤ 古い画面・二重送信の操作は、次の番に使われない
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, upEnabled: false, shugiMul: 0 }).id);
    for (let k = 0; k < 2; k++) await rt.join(W.c.user(W.ps[k]), 5000);
    let seen = null;
    const bots = W.ps.slice(0, 2).map(uid => sub(W, rt, uid, r => { if (!seen) { seen = { uid, rid: r.rid }; return null; } return null; }));
    assert.ok(await until(() => seen && rt.pending));
    const p = rt.pending, u = W.c.user(rt.seats[p.req.seat].userId);
    thr(() => rt.act(u, { act: 'fold', rid: p.req.rid - 1 }), /前の番/);
    assert.strictEqual(rt.pending, p, '古い操作では番が進まない');
    rt.act(u, { act: p.req.type === 'oya' ? 'bet' : 'follow', amount: 100, rid: p.req.rid });
    assert.notStrictEqual(rt.pending, p);
    bots.forEach(b => b.stop()); W.T.stop(aj, rt.id); await until(() => rt.status !== 'running', 8000);
    ok('操作には番号がつき、前の番の操作(古い画面・二重送信)は断る');
  }
  // ⑥ 「○人が出られなくなると終了」は、チップが足りない人だけを数える(参加費の休みでは終わらない)
  {
    const W = world(); const aj = W.c.user(W.aj);
    const row = W.c.db.prepare('SELECT * FROM tables_ WHERE id=?').get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, endZero: 1, leave: 'allow' }).id);
    const rt = new Runtime(W.T, row); rt.status = 'running'; rt.startedAt = Date.now();
    for (let k = 0; k < 3; k++) { rt.seats[k] = { userId: W.ps[k], username: 'pl_' + k, joinedAt: Date.now() }; Object.assign(rt.T.players[k], { pts: 5000, vacant: false, name: 'pl_' + k }); }
    rt.T.players[2].sitout = true;
    assert.strictEqual(await rt.endConditions(false), false, '参加費の休みは数えない');
    rt.T.players[2].sitout = false; rt.T.players[2].pts = 50;
    rt.endTable = () => { rt.ended = true; }; rt.runLast = async () => {};
    assert.strictEqual(await rt.endConditions(false), true); assert.ok(rt.ended);
    ok('「○人が出られなくなると終了」は、チップが足りない人だけを数える(AJがポケットを抜いて休みにしても、卓を終わらせられない)');
  }
  // ⑦ 席を立った人の「流しで場に残った」扱いは、次にその席に座った人へ引き継がない
  {
    const W = world(); const aj = W.c.user(W.aj);
    const row = W.c.db.prepare('SELECT * FROM tables_ WHERE id=?').get(W.T.create(aj, 't', { seats: 4, ante: 100, minBet: 100, limit: 1000, leave: 'allow' }).id);
    const rt = new Runtime(W.T, row);
    rt.T.carry = { survivors: [0, 1], fee: 330 }; rt.T.stake = { 0: 300, 1: 300 };
    rt.forgetSeat(0);
    assert.deepStrictEqual(rt.T.carry.survivors, [1]); assert.strictEqual(rt.T.stake[0], undefined);
    ok('席を立つと、その席の場の持ち分・流しで残った扱いは消える(次に座った人が、払わずに流しの場へ入れない)');
  }
  // ⑧ 設定を混ぜて乱打ち: 離席・復帰・チップの出し入れ・退席・再着席・退会を混ぜても、台帳は合い、卓はエラーで止まらない
  {
    const combos = [
      { startMode: 'free', leave: 'allow', lateJoin: 'allow', upEnabled: true, shugiMul: 1, durationMin: 0 },
      { startMode: 'free', leave: 'deny', lateJoin: 'vote', upEnabled: true, shugiMul: 0, durationMin: 30 },
      { startMode: 'free', leave: 'allow', lateJoin: 'deny', upEnabled: false, shugiMul: 2, limitType: 'perGame', endZero: 2 },
      { startMode: 'condition', chips: 30000, minPlayers: 3, lateJoin: 'allow', upEnabled: true, durationMin: 30, endZero: 2 },
      { startMode: 'condition', chips: 25000, minPlayers: 2, lateJoin: 'deny', upEnabled: true, upLimitType: 'perGame', gameMaxBets: 4, gameMaxUps: 3, durationMin: 20 },
      { startMode: 'free', leave: 'allow', lateJoin: 'allow', upEnabled: true, upLimit: 3000, upResetOnOya: false, gameMaxBets: 2 },
    ];
    let errors = 0, games = 0;
    for (const [ci, cb] of combos.entries()) {
      const W = world({ feeBp: 100, jackpotBp: 200, entryFee: ci % 2 === 0 }); const aj = W.c.user(W.aj);
      W.T.opt.minStayMs = 0;
      const rt = W.T.get(W.T.create(aj, 'mix' + ci, Object.assign({ seats: 5, ante: 100, minBet: 100, limit: 1000 }, cb)).id);
      const bots = {};
      const sit = async k => { try { await rt.join(W.c.user(W.ps[k]), 6000); bots[k] = sub(W, rt, W.ps[k], randomPlay); } catch (e) {} };
      for (let k = 0; k < 4; k++) await sit(k);
      const end = Date.now() + 2500;
      while (Date.now() < end && rt.status === 'running') {
        await sleep(Math.floor(Math.random() * 12));
        const k = Math.floor(Math.random() * 6), u = W.c.user(W.ps[k]), r = Math.random();
        try {
          if (rt.vote && !rt.vote.done && rt.seatOf(u.id) >= 0) rt.castVote(u, Math.random() < 0.6);
          if (rt.seatOf(u.id) < 0) { if (r < 0.3) await sit(k); continue; }
          if (r < 0.12) rt.setAway(u, true); else if (r < 0.3) rt.setAway(u, false);
          else if (r < 0.4) rt.exchange(u, 'in', 500); else if (r < 0.5) rt.exchange(u, 'out', 300);
          else if (r < 0.56) { if (bots[k]) { bots[k].stop(); delete bots[k]; } } else if (r < 0.66) { if (!bots[k]) bots[k] = sub(W, rt, W.ps[k], randomPlay); }
          else if (r < 0.7) rt.leave(u);
        } catch (e) { if (!e.code) throw e; }   // ルールで断られるのは正常(400番台)。それ以外の例外は失敗
        if (rt.T.carry && rt.T.pot > 0) for (const sv of rt.T.carry.survivors) { const st = rt.seats[sv]; if (st) try { rt.exchange(W.c.user(st.userId), 'out', Math.max(1, rt.T.players[sv].pts)); } catch (e) { if (!e.code) throw e; } }   // 流しの最中に、場に残った人が全部持ち出そうとする(以前の穴)
        if (Math.random() < 0.005) W.T.evict(W.ps[Math.floor(Math.random() * 6)]);
        if (W.c.db.prepare('SELECT COUNT(*) c FROM accounts WHERE balance<0').get().c) throw new Error('マイナスの口座 ' + JSON.stringify(cb));
      }
      games += rt.T.gameNo;
      if (rt.status === 'stopped' && rt.log.some(l => /エラー/.test(l.m))) { errors++; console.log('  卓がエラーで止まった', JSON.stringify(cb), rt.log.filter(l => /エラー/.test(l.m)).map(l => l.m)); }
      Object.values(bots).forEach(b => b.stop()); W.T.stop(aj, rt.id);
      await until(() => !['running', 'open'].includes(rt.status) || rt.count() === 0, 20000);
      if (rt.status === 'open') { /* 誰もいなくなった */ }
      const chk = W.c.L.check(); assert.ok(chk.ok, JSON.stringify(chk));
      const left = W.c.db.prepare("SELECT COALESCE(SUM(balance),0) s FROM accounts WHERE acct LIKE 's:%' OR acct LIKE 'p:%' OR acct LIKE 'j:%'").get().s;
      if (rt.status !== 'open') assert.strictEqual(left, 0, '終了後、卓・場・積立にチップが残らない ' + JSON.stringify(cb));
    }
    assert.strictEqual(errors, 0);
    ok(`設定を混ぜた${combos.length}卓で乱打ち(合計${games}ゲーム。離席・復帰・出し入れ・退席・再着席・退会・投票を混ぜる): エラー停止0・マイナス口座0・台帳一致・終了後に卓へチップが残らない`);
  }
  console.log(`\nルールの試験: ${n}項目すべて合格`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
