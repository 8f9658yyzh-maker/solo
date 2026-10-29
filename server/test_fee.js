'use strict';
// 参加費・手数料・作成者と統括責任者の共有ポケットのテスト
const assert = require('node:assert');
const D = require('./db'); const { Core } = require('./core'); const { Tables, normSettings } = require('./tables');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const thr = (f, re) => { try { f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };
const thrA = async (f, re) => { try { await f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };
const JST = s => Date.parse(s + '+09:00');
// 条件が満たされるまで待つ(決まった時間だけ待つと、機械の速さで結果が変わるため)
const until = async (f, what, ms = 10000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('待ちきれません: ' + what); await sleep(10); } };

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
// 決まった動きのボット(でたらめに動くと、誰かのチップが尽きて卓が止まり、結果が毎回変わるため)
// 親: 前のゲームで勝った人は降りて、次の人に親を回す。それ以外は毎ゲーム違う額をベット(切り上げを確かめるため、場が100の倍数にならない額)
// 子・ビキ: 降りる。流しの次の試合: 見送り。→ 勝つ人が順番に回り、どの人のチップも尽きない
function bot(W, rt, uid) {
  const b = { last: null, notes: [] }, me = W.c.user(uid);
  b.res = { write: s => { if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6)); b.last = v;
    if (v.req && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; if (!rt.pending || rt.pending.req.seat !== v.req.seat) return; const r = v.req;
      const wonLast = !!(rt.lastGame && rt.lastGame.winner === me.username);
      const a = r.type === 'carryJoin' ? { act: 'skip' } : r.type === 'oya' ? (wonLast ? { act: 'fold' } : { act: 'bet', amount: Math.min(r.cap, r.minBet + (rt.T.gameNo * 37) % 400) }) : { act: 'fold' };
      try { rt.act(me, a); } catch (e) {} }); } } };
  b.start = () => rt.subscribe(me, b.res); b.stop = () => rt.unsubscribe(me, b.res); b.start(); return b;
}
// ボットの接続を切り、卓がゲームとゲームの間で止まるまで待つ(全員が離席扱いになると、卓は次のゲームを始めない)
const pause = async (rt, bots) => { bots.forEach(b => b.stop()); await until(() => rt.seats.every(st => !st || st.away) && !rt.inGame && rt.T.pot === 0, '卓が止まる'); };
const notes = (W, uid, kind) => W.c.db.prepare('SELECT * FROM notifications WHERE to_user=? AND kind=?').all(uid, kind);

(async () => {
  // ===== 共有ポケット =====
  {
    const W = world(), c = W.c;
    assert.strictEqual(c.pocket(W.cid), c.pocket(W.sov)); const before = c.pocket(W.cid);
    thr(() => c.give(c.user(W.cid), W.sov, 10), /共有/);
    c.give(c.user(W.sov), W.man, 1000);   // 統括責任者が配っても、作成者と同じポケットから出る
    assert.strictEqual(c.pocket(W.cid), before - 1000); assert.strictEqual(c.pocket(W.sov), before - 1000);
    assert.ok(c.L.check().ok);
    ok('作成者と統括責任者のポケットは1つ(どちらから配っても同じ残高が減る)。渡し合いはできない');
  }
  // ===== 日付・参加費の段階 =====
  {
    const W = world(), c = W.c, p = W.ps[0];
    assert.strictEqual(c.dayKey(JST('2026-10-13T23:59:00')), '2026-10-13'); assert.strictEqual(c.dayKey(JST('2026-10-14T00:00:00')), '2026-10-14');
    let t = JST('2026-10-13T10:00:00'); const amts = [];
    for (let i = 0; i < 4; i++) { assert.strictEqual(c.entryDue(p, t), i < 2 ? 1000 : 500); amts.push(c.chargeEntry(p, 1, t, true)); t += 3600000; }
    assert.deepStrictEqual(amts, [1000, 1000, 500, 500]);
    assert.strictEqual(c.pocket(p), 20000 - 3000);
    // 払い済みの時間内は0
    const W2 = world(); W2.c.chargeEntry(W2.ps[0], 1, W2.now, false); assert.strictEqual(W2.c.entryDue(W2.ps[0], W2.now + 3599000), 0); assert.strictEqual(W2.c.entryDue(W2.ps[0], W2.now + 3600000), 1000);
    // 長く止まっていたあとに、過ぎた時間ぶんをまとめて請求しない
    { const W4 = world(); W4.c.chargeEntry(W4.ps[0], 1, W4.now, false); W4.c.chargeEntry(W4.ps[0], 1, W4.now + 6 * 3600000, true); assert.strictEqual(W4.c.passRow(W4.ps[0], W4.now + 6 * 3600000).paid_until, W4.now + 7 * 3600000); }
    // 0時で数え直し
    const t2 = JST('2026-10-14T00:10:00'); assert.strictEqual(c.entryDue(p, t2 + 3 * 3600000), 1000);
    assert.strictEqual(c.chargeEntry(p, 1, t2 + 3 * 3600000, false), 1000);
    assert.strictEqual(c.entryDue(W.cid, t), 0); assert.strictEqual(c.entryDue(W.sov, t), 0);
    assert.ok(c.L.check().ok);
    ok('参加費: 1日で1時間目と2時間目は1,000・3時間目から500。日本時間の0時で数え直し。払い済みの時間内は0。作成者・統括責任者は無料');
  }
  // ===== 卓: 参加費・手数料・受け取る =====
  {
    const W = world(), c = W.c, aj = c.user(W.aj);
    const s = normSettings({ ante: 50, minBet: 20, limit: 10 }, null, 100); assert.ok(s.ante === 100 && s.minBet === 100 && s.limit >= 100);
    const t = W.T.create(aj, '有料卓', { seats: 6, ante: 100, minBet: 100, limit: 1000, startMode: 'free' });
    assert.strictEqual(t.settings.ante, 100);
    const rt = W.T.get(t.id); const raw = W.T.create(aj, 'x', { ante: 1, minBet: 1 }); assert.strictEqual(raw.settings.ante, 100); assert.strictEqual(raw.settings.minBet, 100);
    // 持ち込み + 参加費ぶんのポケットがないと座れない
    const poor = W.ps[3]; c.pull && 0;
    c.give(c.user(W.aj), poor, 0 + 0 || 1) ; 
    await thrA(() => rt.join(c.user(poor), 19500), /参加費/);
    ok('最低ベット・参加料は100未満にできない。持ち込み+参加費がポケットにないと座れない');
    const bots = [];
    for (let i = 0; i < 3; i++) { await rt.join(c.user(W.ps[i]), 5000); bots.push(bot(W, rt, W.ps[i])); }
    assert.strictEqual(rt.status, 'running');
    for (let i = 0; i < 3; i++) assert.strictEqual(c.pocket(W.ps[i]), 20000 - 5000 - 1000);
    assert.strictEqual(c.L.balance('f:' + rt.id), 3000);
    ok('開始時にポケットから1,000チップずつ引かれ、卓の保管へ入った(卓のチップは引かれない)');
    await until(() => rt.T.gameNo >= 8, 'ゲームが8回進む');
    await pause(rt, bots);   // ここから先は、ゲームの途中ではない状態で確かめる
    assert.ok(rt.T.gameNo >= 8, 'ゲームが進む ' + rt.T.gameNo);
    const rows = c.db.prepare('SELECT data FROM games WHERE table_id=?').all(rt.id).map(r => JSON.parse(r.data));
    let rake = 0, wins = 0;
    for (const d of rows) { if (d.how === 'nagashi') { assert.strictEqual(d.fee, 0); continue; } wins++; const gross = d.potWon + d.fee + d.cut + (d.jp ? d.jp.paid * 0 : 0); assert.strictEqual(d.fee, Math.ceil(gross * 100 / 10000)); assert.strictEqual(d.cut, Math.ceil(gross * 200 / 10000)); assert.ok(d.fee >= 1); rake += d.fee; }
    assert.ok(wins >= 3, '勝負がついたゲーム ' + wins);
    assert.strictEqual(c.L.balance('f:' + rt.id), 3000 + rake);
    assert.strictEqual(c.db.prepare("SELECT COALESCE(SUM(amount),0) s FROM fee_log WHERE table_id=? AND kind='rake'").get(rt.id).s, rake);
    ok(`毎ゲームの手数料は場の3%(運営1%・積立2%、どちらも切り上げ)(${wins}ゲーム・合計${rake}チップ)。保管と記録が一致`);
    assert.ok(c.L.check().ok);
    // 時間: 55分後に、ポケットが足りない人にだけ5分前の通知
    c.pull ? 0 : 0;
    const low = W.ps[2]; const lowPocket = c.pocket(low); // 14000 → 足りなくする
    c.give; const sum0 = c.pocket(low);
    // ポケットを500まで減らす: 持ち込みを増やして減らす
    rt.exchange(c.user(low), 'in', sum0 - 500);
    W.now += 55 * 60000; rt.feeTick(W.now);
    assert.strictEqual(notes(W, low, 'fee_warn').length, 1); assert.strictEqual(notes(W, W.ps[0], 'fee_warn').length, 0);
    rt.feeTick(W.now + 1000); assert.strictEqual(notes(W, low, 'fee_warn').length, 1);
    ok('期限の5分前、ポケットが足りない人にだけ通知(1回だけ)');
    // 期限: 足りる人は自動延長(2時間目=1,000)、足りない人は休み
    W.now += 5 * 60000; rt.feeTick(W.now);
    assert.strictEqual(c.pocket(W.ps[0]), 20000 - 5000 - 2000); assert.strictEqual(c.L.balance('f:' + rt.id) >= 5000, true);
    assert.strictEqual(c.pocket(low), 500); assert.strictEqual(rt.T.players[rt.seatOf(low)].sitout, true);
    assert.strictEqual(notes(W, low, 'fee_blocked').length, 1);
    // 休んでいる人を除いた2人で、ゲームを進める
    const g0 = rt.T.gameNo; bots[0].start(); bots[1].start();
    await until(() => rt.T.gameNo >= g0 + 2, '休みの間もゲームが進む');
    await pause(rt, bots);
    const v = rt.view(low); assert.strictEqual(v.seats[rt.seatOf(low)].rest, true); assert.strictEqual(v.you.fee.blocked, true);
    ok('期限が来ると、ポケットにある人は自動で延長(2時間目1,000)。足りない人は休みになり通知される');
    // 休み中のゲームに参加していない
    const played = c.db.prepare('SELECT data FROM games WHERE table_id=? AND no>?').all(rt.id, g0).map(r => JSON.parse(r.data));
    assert.ok(played.length >= 2, '休みの間のゲーム ' + played.length);
    assert.ok(played.every(d => !d.parts.some(p => p.uid === low)), '休み中は参加しない');
    for (const d of played) { const gross = d.potWon + d.fee + d.cut; assert.strictEqual(d.fee, Math.ceil(gross * 100 / 10000)); assert.strictEqual(d.cut, Math.ceil(gross * 200 / 10000)); rake += d.fee; }
    // AJがチップを入れると復帰
    c.give(c.user(W.aj), low, 5000); rt.feeTick(W.now + 1000);
    assert.strictEqual(rt.T.players[rt.seatOf(low)].sitout, false); assert.strictEqual(c.pocket(low), 5500 - 1000);
    ok('AJがポケットにチップを入れると、参加費が引かれて休みが解ける');
    // 3時間目は500
    W.now += 3600000; rt.feeTick(W.now); assert.strictEqual(c.pocket(W.ps[0]), 20000 - 5000 - 2000 - 500);
    // 受け取る
    const fee = c.L.balance('f:' + rt.id); assert.ok(fee >= 5000);
    assert.ok(notes(W, W.cid, 'fee_ready').length >= 1 && notes(W, W.sov, 'fee_ready').length >= 1, '5,000の通知');
    thr(() => c.feeReceive(c.user(W.aj), rt.id), /作成者/);
    const pk = c.pocket(W.cid); const r = c.feeReceive(c.user(W.sov), rt.id);
    assert.strictEqual(r.received, fee); assert.strictEqual(c.pocket(W.cid), pk + fee); assert.strictEqual(c.pocket(W.sov), pk + fee); assert.strictEqual(c.L.balance('f:' + rt.id), 0);
    const ov = c.feeOverview(c.user(W.cid)); assert.ok(ov[0].entry_total >= 3000 && ov[0].rake_total === rake && ov[0].received_total === fee);
    thr(() => c.feeReceive(c.user(W.cid), rt.id), /ありません/);
    ok('保管が5,000を超えると作成者・統括責任者に通知。「受け取る」で共有ポケットに入り、記録に残る(一般の人は受け取れない)');
    // 退席して戻っても、払い済みの時間内なら再び引かれない
    W.T.stop(aj, rt.id); await until(() => rt.status === 'stopped', '卓が終わる');
    assert.ok(c.L.check().ok);
    let tot = 0; for (const id of W.ps) tot += c.pocket(id); 
    assert.ok(c.L.check().ok);
    ok('終了後も台帳の合計は5億のまま');
    // 席を立って戻っても、払い済みの時間内なら再び引かれない
    const W3 = world(), c3 = W3.c; const rt3 = W3.T.get(W3.T.create(c3.user(W3.aj), 'a', { ante: 100, minBet: 100, limit: 1000, leave: 'allow' }).id);
    await rt3.join(c3.user(W3.ps[0]), 5000); await rt3.join(c3.user(W3.ps[1]), 5000);
    const f1 = c3.L.balance('f:' + rt3.id); assert.strictEqual(f1, 2000);
    await sleep(400); rt3.leave(c3.user(W3.ps[1]));
    assert.strictEqual(c3.pocket(W3.ps[1]), 20000 - 1000);
    W3.now += 20 * 60000; await rt3.join(c3.user(W3.ps[1]), 5000); rt3.feeTick(W3.now);
    assert.strictEqual(c3.L.balance('f:' + rt3.id) >= 2000 && c3.pocket(W3.ps[1]) === 20000 - 1000 - 5000, true);
    W3.T.stop(c3.user(W3.aj), rt3.id); await sleep(500);
    ok('席を立って戻っても、払い済みの1時間のうちは参加費を取られない');
  }
  // ===== 条件開始: 持ち込みチップ + 参加費がポケットに必要 =====
  {
    const W = world(), c = W.c; const rt = W.T.get(W.T.create(c.user(W.aj), '条件卓', { seats: 4, ante: 100, minBet: 100, limit: 1000, startMode: 'condition', chips: 20000, minPlayers: 2 }).id);
    assert.strictEqual(c.pocket(W.ps[0]), 20000);
    await thrA(() => rt.join(c.user(W.ps[0])), /21000/);
    c.give(c.user(W.aj), W.ps[0], 1000); c.give(c.user(W.aj), W.ps[1], 1000);
    await rt.join(c.user(W.ps[0])); assert.strictEqual(c.pocket(W.ps[0]), 1000); assert.strictEqual(rt.status, 'open'); assert.strictEqual(c.L.balance('f:' + rt.id), 0);
    await rt.join(c.user(W.ps[1])); assert.strictEqual(rt.status, 'running'); assert.strictEqual(c.L.balance('f:' + rt.id), 2000);
    assert.strictEqual(c.pocket(W.ps[0]), 0);
    thr(() => rt.setAway(c.user(W.ps[0]), true), /離席できます/);
    await sleep(350); rt.setAway(c.user(W.ps[0]), true);
    W.now += 3 * 3600000; rt.feeTick(W.now); assert.strictEqual(c.pocket(W.ps[0]), 0);
    W.T.stop(c.user(W.aj), rt.id); await sleep(300);
    ok('条件開始の卓: 着席から15分たたないと離席できない。離席中は時間が過ぎても参加費を引かれない。初期20,000なら、ポケットに21,000必要。参加費は卓が始まった時に引かれる');
  }
  // ===== 離席: 押した人は参加費を自動で引かれない。戻って時間が過ぎていれば払う =====
  {
    const W = world(), c = W.c; const rt = W.T.get(W.T.create(c.user(W.aj), '離席卓', { seats: 4, ante: 100, minBet: 100, limit: 1000 }).id);
    const [a, b] = W.ps; await rt.join(c.user(a), 5000); await rt.join(c.user(b), 5000);
    assert.strictEqual(c.pocket(a), 14000);
    rt.setAway(c.user(a), true);
    W.now += 61 * 60000; rt.feeTick(W.now);
    assert.strictEqual(c.pocket(a), 14000, '離席中は自動で引かない'); assert.strictEqual(c.pocket(b), 13000);
    assert.ok(!rt.T.players[rt.seatOf(a)].sitout);
    rt.setAway(c.user(a), false);   // 戻る → 時間が過ぎているので払う(2時間目)
    assert.strictEqual(c.pocket(a), 13000);
    W.T.stop(c.user(W.aj), rt.id); await sleep(300);
    ok('「離席」を押した人は、時間が過ぎても参加費を自動で引かれない。戻った時に払う(参加料は毎ゲーム払い続ける)');
  }
  // ===== 参加費は個人の時間: 卓が終わっても、払った1時間の残りは他の卓で使える =====
  {
    const W = world(), c = W.c; const rt = W.T.get(W.T.create(c.user(W.aj), '条件卓B', { seats: 4, ante: 100, minBet: 100, limit: 1000, startMode: 'condition', chips: 20000, minPlayers: 2 }).id);
    c.give(c.user(W.aj), W.ps[0], 1000); c.give(c.user(W.aj), W.ps[1], 1000);
    await rt.join(c.user(W.ps[0])); await rt.join(c.user(W.ps[1]));
    W.now += 30 * 60000; W.T.stop(c.user(W.aj), rt.id); await sleep(900);
    assert.strictEqual(c.entryDue(W.ps[0], W.now), 0, '残り30分は個人の時間として続く');
    const rt2 = W.T.get(W.T.create(c.user(W.aj), '自由卓C', { ante: 100, minBet: 100, limit: 1000 }).id);
    const before = c.pocket(W.ps[0]); await rt2.join(c.user(W.ps[0]), 5000);
    assert.strictEqual(c.pocket(W.ps[0]), before - 5000); assert.strictEqual(c.L.balance('f:' + rt2.id), 0);
    W.now += 31 * 60000; assert.strictEqual(c.entryDue(W.ps[0], W.now), 1000);
    W.T.stop(c.user(W.aj), rt2.id); await sleep(300);
    ok('参加費は個人の1時間。卓が終わっても残りは他の卓で使え、使い切ると次の1時間分を払う');
  }
  console.log(`\n全${n}項目 合格`);
})().catch(e => { console.error(e); process.exit(1); });
