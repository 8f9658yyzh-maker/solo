'use strict';
// ジャックポット(積立・途中参加の按分・ラストゲーム・分配・復旧)のテスト
const assert = require('node:assert');
const D = require('./db'); const { Core } = require('./core'); const { Tables, normSettings } = require('./tables');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const thr = (f, re) => { try { f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };
const thrA = async (f, re) => { try { await f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };
const JST = s => Date.parse(s + '+09:00');

function world() {
  const d = D.open(':memory:'), c = new Core(d);
  const cid = c.bootstrap('kaito', 'password-1', '09000000001'); const me = c.user(cid);
  const mk = (by, role, name, i) => { const inv = c.createInvite(c.user(by), role); return c.signup({ invite: inv.code, username: name, password: 'password-' + name, phone: '0900000' + String(1000 + i), deviceId: 'device-' + name + '-xx', ip: '10.0.0.' + i, age18: true, agree: true }).id || c.db.prepare('SELECT id FROM users WHERE username=?').get(name).id; };
  const sov = mk(cid, 'sovereign', 'touhatsu', 5);
  const man = mk(cid, 'manager', 'kanri', 1), aj = mk(man, 'aj', 'aj_one', 2);
  c.give(c.user(sov), man, 10000000); c.give(c.user(man), aj, 5000000);
  const ps = [];
  for (let i = 0; i < 4; i++) { const id = mk(aj, 'player', 'play' + (i + 1), 10 + i); c.give(c.user(aj), id, 20000); ps.push(id); }
  const W = { d, c, cid, me, sov, man, aj, ps, now: JST('2026-10-13T10:00:00') };
  W.T = new Tables(c, { turnMs: 3000, voteMs: 2000, graceMs: 150, minStayMs: 300, disconnectGraceMs: 100, beatScale: 0, feeTickMs: 0, clock: () => W.now });
  return W;
}
function bot(W, rt, uid) {
  const b = { last: null, notes: [] };
  b.res = { write: s => { if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6)); b.last = v;
    if (v.req && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; if (!rt.pending || rt.pending.req.seat !== v.req.seat) return; const r = v.req;
      const a = r.type === 'carryJoin' ? { act: 'skip' } : r.type === 'oya' ? { act: Math.random() < 0.5 ? 'bet' : 'fold', amount: r.cap } : r.type === 'biki' ? { act: 'follow', up: 0 } : { act: Math.random() < 0.5 ? 'follow' : 'fold' };
      try { rt.act(W.c.user(uid), a); } catch (e) {} }); } } };
  rt.subscribe(W.c.user(uid), b.res); b.stop = () => rt.unsubscribe(W.c.user(uid), b.res); return b;
}
const notes = null;
const Solo = require('../engine.js');
const mkT = (extra) => Solo.createTable(Object.assign({ seats: 4, ante: 100, minBet: 100, limit: 1000, reserve: 10, startPts: 100000, minUnit: 100 }, extra || {}), { feeBp: 100, jpBp: 200, humans: [0, 1, 2, 3] });
// 台本どおりに動く人間: oya は「勝負」(2人のとき)か「最小ベット」、ほかは降りる
const script = foldAll => async r => r.type === 'oya' ? (r.canShow && !foldAll ? { act: 'show' } : { act: 'bet', amount: r.minBet }) : { act: 'fold' };
const total = T => T.players.reduce((a, p) => a + p.pts, 0) + T.pot + T.jp.pool + T.feeNew;

(async () => {
  // ===== 手数料の分け方と積み上げ =====
  {
    const T = mkT(); const t0 = total(T);
    T.players[3].vacant = true;
    const r = await Solo.playGame(T, { human: script(true), beat: async () => {} }, { fixedHands: { 0: [3, 4], 1: [7, 8], 2: [1, 9] } });
    assert.strictEqual(r.type, 'win');
    const gross = r.potGross; assert.strictEqual(r.fee, Math.ceil(gross * 100 / 10000)); assert.strictEqual(r.cut, Math.ceil(gross * 200 / 10000));
    assert.strictEqual(r.potWon, gross - r.fee - r.cut); assert.strictEqual(T.jp.pool, r.cut);
    assert.deepStrictEqual(Object.keys(T.jp.ent).sort(), ['0', '1', '2']); assert.strictEqual(T.jp.ent[0], r.cut); assert.strictEqual(T.jp.ent[3], undefined);
    assert.strictEqual(total(T), t0);
    ok('手数料3%のうち運営1%・積立2%(切り上げ)。参加した人だけが積み上げに数えられる。チップの合計は変わらない');
  }
  // ===== 10ソロで積立を受け取る(勝負) =====
  {
    const T = mkT(); T.players[2].vacant = T.players[3].vacant = true; const t0 = total(T);
    for (let k = 0; k < 4; k++) await Solo.playGame(T, { human: script(true), beat: async () => {} }, { fixedHands: { 0: [3, 4], 1: [7, 8] } });
    const pool0 = T.jp.pool; assert.ok(pool0 > 0 && T.jp.ent[0] === pool0 && T.jp.ent[1] === pool0);
    const before = T.players[0].pts;
    const r = await Solo.playGame(T, { human: script(false), beat: async () => {} }, { oya: 0, fixedHands: { 0: [10, 10], 1: [7, 8] } });
    assert.strictEqual(r.how, 'show'); assert.strictEqual(r.winner, 0); assert.ok(r.jp && r.jp.paid === pool0 + r.cut, '積立すべて(今回の分を含む)');
    assert.strictEqual(T.jp.pool, 0); assert.deepStrictEqual(T.jp.ent, {}); assert.strictEqual(T.color, 'black', '10ソロで山札の色が変わる');
    assert.strictEqual(r.shugi.unit, 100 * 10, '祝儀=参加料×数字'); assert.strictEqual(r.shugi.total, 1000);
    assert.strictEqual(total(T), t0);
    ok('10ソロ(勝負)で積立を全額受け取り、積立は0から再開。祝儀は参加料×10=1,000');
  }
  // ===== 全員降りで勝った人が10ソロ: 手札を見せて受け取る / 弱い手なら受け取らない =====
  {
    const T = mkT(); T.players[2].vacant = T.players[3].vacant = true; const t0 = total(T);
    await Solo.playGame(T, { human: script(true), beat: async () => {} }, { oya: 1, fixedHands: { 0: [3, 4], 1: [7, 8] } });
    assert.ok(T.jp.pool > 0);
    const r0 = await Solo.playGame(T, { human: script(true), beat: async () => {} }, { oya: 0, fixedHands: { 0: [9, 9], 1: [2, 3] } });
    assert.strictEqual(r0.how, 'fold'); assert.ok(!r0.jp, '9のソロでは当たらない(既定は10だけ)'); assert.deepStrictEqual(r0.showdown, []);
    const r = await Solo.playGame(T, { human: script(true), beat: async () => {} }, { oya: 0, fixedHands: { 0: [10, 10], 1: [2, 3] } });
    assert.strictEqual(r.how, 'fold'); assert.ok(r.jp && r.jp.reveal && r.jp.paid > 0); assert.strictEqual(r.showdown.length, 1); assert.strictEqual(r.shugi, null, '全員降りには祝儀なし');
    assert.strictEqual(total(T), t0);
    ok('全員降りで勝った人が10ソロなら、その人の手札だけ見せて積立を受け取る(祝儀はなし)');
  }
  // ===== 途中参加の按分 =====
  {
    const T = mkT(); T.players[2].vacant = true; T.players[3].vacant = true; const t0 = total(T);
    for (let k = 0; k < 6; k++) await Solo.playGame(T, { human: script(true), beat: async () => {} }, { fixedHands: { 0: [3, 4], 1: [7, 8] } });
    const early = T.jp.pool;   // 席0・1だけで積み上げた分
    T.players[2].vacant = false; T.players[2].pts = 100000; Solo.jpForget(T, 2); T.players[2].human = true;
    const t1 = total(T);
    for (let k = 0; k < 3; k++) await Solo.playGame(T, { human: script(true), beat: async () => {} }, { oya: 0, fixedHands: { 0: [3, 4], 1: [7, 8], 2: [1, 2] } });
    const late = T.jp.ent[2], pool = T.jp.pool; assert.ok(late > 0 && late < pool && T.jp.ent[0] === pool && pool - late >= early);
    const r = await Solo.playGame(T, { human: script(false), beat: async () => {} }, { oya: 2, fixedHands: { 0: [3, 4], 1: [7, 8], 2: [10, 10] } });
    // 3人参加で、2が親でベットしてほかが降りるので全員降り扱い→当たりは手札公開。勝負にするため別途確認
    assert.ok(r.jp && r.jp.paid === late + r.cut, '遅れて入った人は、参加してからの分だけ'); assert.ok(r.jp.paid < r.jp.pool);
    assert.strictEqual(T.jp.pool, r.jp.pool - r.jp.paid); assert.ok(T.jp.pool > 0, '残りは次の積立へ');
    const left = T.jp.pool; assert.deepStrictEqual(Object.keys(T.jp.ent).sort(), ['0', '1', '2']); assert.ok(Object.values(T.jp.ent).every(v => v === left));
    assert.strictEqual(total(T), t0);
    ok('途中参加の人が10ソロを出すと、参加してからの積み上がり分だけ受け取り、残りは今いる人の次の積立に回る');
  }
  // ===== 席を立つと積み上げ分を失う =====
  {
    const T = mkT(); T.players[2].vacant = T.players[3].vacant = true;
    for (let k = 0; k < 3; k++) await Solo.playGame(T, { human: script(true), beat: async () => {} }, { fixedHands: { 0: [3, 4], 1: [7, 8] } });
    assert.ok(T.jp.ent[1] > 0); Solo.jpForget(T, 1); T.players[1].vacant = true; assert.strictEqual(T.jp.ent[1], undefined);
    const sh = Solo.jpShares(T); assert.deepStrictEqual(Object.keys(sh), ['0']); assert.strictEqual(sh[0], T.jp.pool);
    ok('席を立った人の積み上げ分は消え、強制終了の分配は座っている人にだけ渡る(合計は積立と一致)');
  }
  // ===== 分配(強制終了)の端数 =====
  {
    const T = mkT(); T.jp.pool = 1001; T.jp.ent = { 0: 300, 1: 100, 2: 100 }; T.players[3].vacant = true;
    const sh = Solo.jpShares(T); assert.strictEqual(Object.values(sh).reduce((a, b) => a + b, 0), 1001); assert.ok(sh[0] > sh[1]);
    ok('分配は積み上げ分に比例。端数も含めて合計が積立と一致');
  }
  // ===== ラストゲーム =====
  {
    for (let it = 0; it < 120; it++) {
      const T = mkT(); T.players[3].vacant = true;
      T.jp.pool = 9000; T.jp.ent = { 0: 9000, 1: 4500, 2: 1000 }; const t0 = total(T);
      const rr = []; const r = await Solo.playLastGame(T, { beat: async () => {}, roundDone: async x => { rr.push(x); } });
      assert.strictEqual(T.jp.pool, 0); assert.strictEqual(total(T), t0); assert.ok(rr.length >= 1 && rr.every(x => x.how === 'jackpot'));
      for (const x of rr) { assert.ok(x.jp.paid <= 9000); assert.strictEqual(x.showdown.length >= 1, true); }
      assert.strictEqual(Object.values(r.total).reduce((a, b) => a + b, 0), 9000);
      const w0 = rr[0].winner; assert.ok(rr[0].jp.paid <= ({ 0: 9000, 1: 4500, 2: 1000 })[w0]);
    }
    ok('ラストゲーム(120回): 積立はちょうど全額が配られ、1位でも自分の積み上げ分を超えず、足りない分は次の人へ。チップの合計は不変');
  }
  // ===== サーバー: 強制終了・時間終了のラストゲーム・復旧 =====
  {
    const W = world(), c = W.c, aj = c.user(W.aj);
    W.T.opt.jackpotBp = 200; W.T.opt.feeBp = 100;
    const mkTable = async (name, extra) => {
      // 前の卓でボットを止めたあと「チップ不足で戻らない」が数えられ、タイミングしだいで3回目の自動退会になることがあった。卓ごとに数え直す
      c.db.prepare("DELETE FROM suspicion WHERE kind LIKE 'nuisance:%'").run();
      for (const u of W.ps.slice(0, 3)) if (c.pocket(u) < 20000) c.give(c.user(W.aj), u, 20000 - c.pocket(u));
      const t = W.T.create(aj, name, Object.assign({ seats: 6, ante: 100, minBet: 100, limit: 1000, startMode: 'free' }, extra || {}));
      const rt = W.T.get(t.id); const bots = [];
      for (let i = 0; i < 3; i++) { await rt.join(c.user(W.ps[i]), 5000); bots.push(bot(W, rt, W.ps[i])); }
      return { rt, bots };
    };
    // 人が0になったら、残った積立は運営の保管へ。そのあとで設定を変えられる
    { const { rt, bots } = await mkTable('空になる卓'); await sleep(1500); bots.forEach(b => b.stop());
      for (let k = 0; k < 300 && rt.T.g && rt.T.g.phase !== 'done'; k++) await sleep(100);
      assert.ok(rt.T.jp.pool > 0); thr(() => W.T.updateSettings(aj, rt.id, '', { ante: 200, minBet: 200, limit: 2000 }), /着席している人/);
      const f0 = c.L.balance('f:' + rt.id);
      for (let i = 0; i < 6; i++) if (rt.seats[i]) rt.removeSeat(i, 'leave');
      assert.strictEqual(rt.T.jp.pool, 0); assert.strictEqual(c.L.balance('j:' + rt.id), 0); assert.ok(c.L.balance('f:' + rt.id) > f0, '運営の保管へ入った'); assert.ok(c.L.check().ok);
      ok('人が0になると、残った積立は運営の保管へ入り、台帳は合ったまま。着席中は設定を変えられない'); }
    // 手札確認チケット
    for (const u of W.ps.slice(0, 3)) if (c.pocket(u) < 20000) c.give(c.user(W.aj), u, 20000 - c.pocket(u));
    { thr(() => c.peekGrant(c.user(W.aj), W.ps[0], 2), /権限/); assert.strictEqual(c.peekGrant(c.user(W.cid), W.ps[0], 2), 2); assert.strictEqual(c.peekGrant(c.user(W.cid), W.ps[1], 2), 2); thr(() => c.peekSpend(W.ps[3], 'x'), /チケットがありません/);
      const t = W.T.create(aj, 'チケット卓', { seats: 6, ante: 100, minBet: 100, limit: 1000, startMode: 'free' }); const rt = W.T.get(t.id);
      for (let i = 0; i < 3; i++) await rt.join(c.user(W.ps[i]), 5000);
      const mkFold = uid => { const b = { res: { write: s => { if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6)); if (v.req && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; if (!rt.pending || rt.pending.req.seat !== v.req.seat) return; const r = v.req;
        const a = r.type === 'carryJoin' ? { act: 'skip' } : r.type === 'oya' ? { act: 'bet', amount: r.minBet } : { act: 'fold' }; try { rt.act(c.user(uid), a); } catch (e) {} }); } } } }; rt.subscribe(c.user(uid), b.res); b.stop = () => rt.unsubscribe(c.user(uid), b.res); return b; };
      const bots = W.ps.slice(0, 3).map(mkFold); W.T.opt.beatScale = 0.05;
      const nm = u => c.user(u).username; let ok0 = false;
      for (let k = 0; k < 6000 && !ok0; k++) { await sleep(10); ok0 = rt.peekOpen(); }
      if (!ok0) console.log('DBG', rt.status, rt.lastGame && { no: rt.lastGame.no, how: rt.lastGame.how, w: rt.lastGame.winner, h: rt.lastGame.hands }, rt.T.g && { no: rt.T.g.no, ph: rt.T.g.phase });
      assert.ok(ok0, '全員降りのゲームが終わった直後の状態になる');
      const win = rt.lastGame.winner, V = [W.ps[0], W.ps[1]].find(u => nm(u) !== win), other = W.ps.slice(0, 3).find(u => u !== V);
      const tg = rt.view(V).peek.targets; assert.strictEqual(tg.length, 2, '自分以外の2人が選べる'); assert.ok(tg.every(t => t.hand === null) && tg.filter(t => t.winner).length === 1);
      thr(() => rt.peek(c.user(V), nm(V)), /自分の手札/); thr(() => rt.peek(c.user(V), 'nobody'), /見られません/); assert.strictEqual(rt.view(W.ps[3]).peek, null, '座っていない人には出ない');
      const wn = tg.find(t => t.winner).name, ln = tg.find(t => !t.winner).name;
      const r1 = rt.peek(c.user(V), wn); assert.ok(Array.isArray(r1.hand) && r1.hand.length >= 1 && r1.left === 1 && r1.winner === true);
      const r2 = rt.peek(c.user(V), ln); assert.ok(Array.isArray(r2.hand) && r2.left === 0 && r2.winner === false, '同じゲームで、持っている枚数の範囲なら続けて見られる');
      thr(() => rt.peek(c.user(V), wn), /すでに見て/); assert.strictEqual(c.peekBalance(V), 0);
      const vv = rt.view(V).peek.targets; assert.deepStrictEqual(vv.find(t => t.winner).hand, r1.hand); assert.deepStrictEqual(vv.find(t => !t.winner).hand, r2.hand);
      assert.ok(rt.view(other).peek.targets.every(t => t.hand === null), '他の人には見えない');
      const nT = W.ps.slice(0, 3).find(u => u !== V && c.peekBalance(u) === 0); if (nT) thr(() => rt.peek(c.user(nT), nm(V)), /チケットがありません/);
      for (let k = 0; k < 2000 && rt.peekOpen(); k++) await sleep(10);
      thr(() => rt.peek(c.user(V)), /いま見られる/); assert.strictEqual(c.peekBalance(V), 0, '使えなかったときは減らない');
      bots.forEach(b => b.stop()); W.T.stop(aj, rt.id); W.T.opt.beatScale = 0; for (let k = 0; k < 300 && !['stopped', 'ended'].includes(rt.status); k++) await sleep(100);
      ok('手札確認チケット: 全員降りのゲームの終了後〜次のゲーム前に、座っている人が1枚で1人分の手札(勝者・降りた人)を見られる(持っている枚数の範囲で何人分でも・同じ人は1回・本人だけ・券なしは不可・使えないときは減らない)'); }
    // 観戦(着席していない人)には、積立も細かい数字も見せない
    { const { rt, bots } = await mkTable('見せない卓'); await sleep(1500); for (let k = 0; k < 300 && !(rt.T.jp.pool > 0); k++) await sleep(50);   // 負荷が高いと最初のゲームが遅れる
      const sit = rt.view(W.ps[0]), out = rt.view(W.ps[3]), boss = rt.view(W.cid);
      assert.ok(sit.jp.on && sit.jp.pool > 0, '着席者には積立が見える'); assert.ok(sit.seats.filter(x => !x.empty).every(x => typeof x.chips === 'number'));
      assert.strictEqual(out.jp.on, false); assert.strictEqual(out.jp.pool, undefined); assert.ok(out.seats.filter(x => !x.empty).every(x => x.chips === null && x.net === null)); assert.deepStrictEqual(out.log, []); assert.strictEqual(out.watch, true);
      assert.ok(boss.jp.on && boss.jp.pool > 0, '運営(作成者)は、座っていなくても積立が見える'); assert.ok(boss.seats.filter(x => !x.empty).every(x => typeof x.chips === 'number'), '管理側は細かい数字を見られる');
      if (out.result) { assert.strictEqual(out.result.paid, undefined); assert.strictEqual(out.result.deltas, undefined); assert.strictEqual(out.result.jp, undefined); assert.strictEqual(out.result.pot, undefined); }
      assert.ok(!JSON.stringify(out).includes('"pool"'), '積立の額は、どこにも入っていない');
      bots.forEach(b => b.stop()); W.T.stop(aj, rt.id); for (let k = 0; k < 300 && !['stopped', 'ended'].includes(rt.status); k++) await sleep(100);
      ok('着席していない人(観戦)には、積立・他の人のチップ・結果の金額・ログを渡さない(管理側は、積立以外の数字は見られる)'); }
    // 強制終了
    { const { rt, bots } = await mkTable('停止卓'); await sleep(1500); assert.ok(c.L.balance('j:' + rt.id) > 0, '積立がたまる');
      const jb = () => c.L.balance('j:' + rt.id); assert.strictEqual(jb(), rt.T.jp.pool, '台帳と一致');
      const pk = W.ps.slice(0, 3).map(u => c.pocket(u)); W.T.stop(aj, rt.id); await sleep(1200); bots.forEach(b => b.stop());
      assert.strictEqual(jb(), 0); assert.ok(c.L.check().ok); assert.strictEqual(rt.status, 'stopped');
      assert.ok(W.ps.slice(0, 3).every((u, i) => c.pocket(u) >= pk[i]), 'チップはポケットへ戻る');
      ok('強制終了すると、積立は積み上げ分に応じて座っている人に分けられ、卓の台帳はすべて0になる'); }
    // 時間終了
    { const { rt, bots } = await mkTable('時間卓', { durationMin: 1 }); await sleep(800); for (let k = 0; k < 100 && c.L.balance('j:' + rt.id) <= 0; k++) await sleep(100); rt.startedAt = Date.now() - 61000;
      for (let k = 0; k < 400 && rt.status === 'running'; k++) await sleep(100);
      assert.ok(['ended'].includes(rt.status), 'time end ' + rt.status + ' pot=' + rt.T.pot + ' carry=' + JSON.stringify(rt.T.carry) + ' g=' + (rt.T.g && rt.T.g.phase)); bots.forEach(b => b.stop());
      assert.strictEqual(c.L.balance('j:' + rt.id), 0); assert.ok(c.L.check().ok);
      const how = c.db.prepare("SELECT how FROM games WHERE table_id=? ORDER BY no DESC").all(rt.id).map(x => x.how);
      assert.ok(how.includes('jackpot'), 'ラストゲームの記録がある ' + how.slice(0, 4));
      ok('時間終了では、終わる前にラストゲームが1回行われ、積立が配られて0になる(記録に残る)'); }
    // 脱落人数型: 1人がゲームに出られなくなったら、ラストゲームのあと終了
    { for (const u of W.ps.slice(0, 3)) if (c.pocket(u) < 20000) c.give(c.user(W.aj), u, 20000 - c.pocket(u));
      const t = W.T.create(aj, '脱落卓', { seats: 6, ante: 100, minBet: 100, limit: 100, startMode: 'free', endZero: 1 });
      const rt = W.T.get(t.id), bots = []; let poolAtLast = -1; const orig = rt.runLast.bind(rt); rt.runLast = async () => { poolAtLast = rt.T.jp.pool; return orig(); };
      await rt.join(c.user(W.ps[0]), 5000); bots.push(bot(W, rt, W.ps[0]));
      await rt.join(c.user(W.ps[1]), 5000); bots.push(bot(W, rt, W.ps[1]));
      await rt.join(c.user(W.ps[2]), 1200); bots.push(bot(W, rt, W.ps[2]));   // 少ない持ち分: 数ゲームで参加料が払えなくなる
      for (let k = 0; k < 1200 && rt.status === 'running'; k++) await sleep(100);
      assert.strictEqual(rt.status, 'ended', '脱落で終了 ' + rt.status + ' pot=' + rt.T.pot); bots.forEach(b => b.stop());
      assert.strictEqual(c.L.balance('j:' + rt.id), 0, '積立は0'); assert.ok(c.L.check().ok);
      const how = c.db.prepare("SELECT how FROM games WHERE table_id=? ORDER BY no DESC").all(rt.id).map(x => x.how);
      assert.ok(poolAtLast >= 0, '終了前にラストゲームの処理に入った'); assert.ok(poolAtLast === 0 || how.includes('jackpot'), 'ラストゲームの記録がある pool=' + poolAtLast + ' ' + how.slice(0, 4));
      ok('脱落人数型でも、終わる前にラストゲームが行われ、積立が配られて0になる(チップの合計は不変)'); }
    // 復旧
    for (const u of W.ps.slice(0, 3)) if (c.pocket(u) < 20000) c.give(c.user(W.aj), u, 20000 - c.pocket(u));
    { const { rt, bots } = await mkTable('復旧卓'); await sleep(1200); bots.forEach(b => b.stop());
      const pool = c.L.balance('j:' + rt.id); assert.ok(pool > 0);
      const T2 = new Tables(c, { beatScale: 0, minUnit: 1, feeBp: 0, jackpotBp: 0, entryFee: false, feeTickMs: 0 });
      // 動いたままの卓を、そのまま止めた状態の再起動とみなす
      rt.stopReq = true; rt.status = 'stopped'; await sleep(100); rt.loopOn = false;
      c.db.prepare("UPDATE tables_ SET status='running' WHERE id=?").run(rt.id);
      const st = JSON.parse(c.db.prepare('SELECT state FROM tables_ WHERE id=?').get(rt.id).state || '{}'); st.jp = st.jp || {}; 
      c.db.prepare('UPDATE tables_ SET state=? WHERE id=?').run(JSON.stringify(Object.assign(st, { jp: { [W.ps[0]]: 300, [W.ps[1]]: 100 } })), rt.id);
      const p0 = c.pocket(W.ps[0]) + c.L.balance('s:' + rt.id + ':' + W.ps[0]) + c.L.balance('p:' + rt.id) * 0, p1 = c.pocket(W.ps[1]);
      const n = T2.recover(); assert.ok(n >= 1); assert.strictEqual(c.L.balance('j:' + rt.id), 0); assert.ok(c.L.check().ok);
      const got = u => c.db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE kind='recover_jp' AND acct=?").get('u:' + u).s;
      assert.strictEqual(got(W.ps[0]) + got(W.ps[1]), pool); assert.ok(Math.abs(got(W.ps[0]) - 3 * got(W.ps[1])) <= 3, '3:1');
      ok('再起動の復旧では、保存してある積み上げ分に応じて積立がポケットへ戻る(合計は5億のまま)'); }
    // 祝儀・設定
    { const s = normSettings({ ante: 100, minBet: 100, limit: 1000, shugiMul: 0 }, null, 100, 1); assert.strictEqual(s.shugiMul, 0);
      const s1 = normSettings({ ante: 100, minBet: 100, limit: 1000, shugiMul: 1, reserve: 10 }, null, 100, 1); assert.strictEqual(s1.reserve, 1000, '祝儀の最大額ぶん(参加料×10)は手元に残す');
      const s2 = normSettings({ ante: 100, minBet: 100, limit: 1000, shugiMul: 1 }, null, 100, 2); assert.strictEqual(s2.shugiMul, 2, '最低倍率に引き上げ');
      ok('祝儀は「なし」にできる。つける場合は参加料×10×倍率が手元に残る設定になり、アプリの最低倍率を下回れない'); }
  }
  console.log('\n全' + n + '項目 合格'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
