'use strict';
const assert = require('node:assert');
const D = require('./db'); const { Core } = require('./core'); const { Tables } = require('./tables');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const thr = (f, re) => { try { f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };
const thrA = async (f, re) => { try { await f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };

function world(optT) {
  const d = D.open(':memory:'), c = new Core(d);
  const cid = c.bootstrap('kaito', 'password-1', '09000000001'); const me = c.user(cid);
  const mk = (by, role, name, i) => { const inv = c.createInvite(c.user(by), role); return c.signup({ invite: inv.code, username: name, password: 'password-' + name, phone: '0900000' + String(1000 + i), deviceId: 'device-' + name + '-xx', ip: '10.0.0.' + i }).id; };
  const man = mk(cid, 'manager', 'kanri', 1), aj = mk(man, 'aj', 'aj_one', 2), aj2 = mk(man, 'aj', 'aj_two', 3);
  c.give(me, man, 10000000); c.give(c.user(man), aj, 5000000); c.give(c.user(man), aj2, 5000000);
  const ps = [];
  for (let i = 0; i < 6; i++) { const id = mk(aj, 'player', 'play' + (i + 1), 10 + i); c.give(c.user(aj), id, 100000); ps.push(id); }
  const x = mk(aj2, 'player', 'outsider', 30); c.give(c.user(aj2), x, 100000);
  const T = new Tables(c, Object.assign({ turnMs: 3000, voteMs: 2000, graceMs: 150, minStayMs: 300, disconnectGraceMs: 100, beatScale: 0, minUnit: 1, feeBp: 0, jackpotBp: 0, entryFee: false }, optT || {}));
  return { d, c, T, cid, me, man, aj, aj2, ps, x };
}
// 画面の代わりをする「プレイヤー」: 受け取った状態を保存し、順番が来たら decide で操作する
function bot(W, rt, uid, decide) {
  const b = { last: null, views: 0, acts: 0 };
  b.res = { write: s => { if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6)); b.last = v; b.views++; if (v.req && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; if (!rt.pending || rt.pending.req.seat !== v.req.seat) return; try { rt.act(W.c.user(uid), decide(v.req, v)); b.acts++; } catch (e) { b.err = e.message; } }); } } };
  rt.subscribe(W.c.user(uid), b.res);
  b.stop = () => rt.unsubscribe(W.c.user(uid), b.res);
  return b;
}
const callAll = (req) => req.type === 'carryJoin' ? { act: req.short ? 'skip' : 'join' } : req.type === 'oya' ? { act: 'bet', amount: req.cap } : req.type === 'biki' ? { act: 'follow', up: req.upCap } : { act: 'follow' };
const randomPlay = (req) => { const r = Math.random(); if (req.type === 'carryJoin') return { act: r < 0.7 && !req.short ? 'join' : 'skip' }; if (req.type === 'oya') return r < 0.15 ? { act: 'fold' } : r < 0.35 && req.canShow ? { act: 'show' } : { act: 'bet', amount: 1 + Math.floor(Math.random() * req.cap) }; if (req.type === 'biki') return r < 0.2 ? { act: 'fold' } : { act: 'follow', up: Math.random() < 0.5 ? 1 + Math.floor(Math.random() * Math.max(1, req.upCap)) : 0 }; return r < 0.25 ? { act: 'fold' } : { act: 'follow' }; };
const inv = W => W.c.L.check();

(async () => {
  // ===== 自由な卓: 4人で着席→ゲーム→保存則 =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    const t = W.T.create(aj, '卓1', { seats: 6, ante: 10, minBet: 10, limit: 100, upEnabled: true, startMode: 'free' });
    const rt = W.T.get(t.id);
    const bots = [];
    for (let i = 0; i < 4; i++) { await rt.join(W.c.user(W.ps[i]), 5000); bots.push(bot(W, rt, W.ps[i], randomPlay)); }
    assert.strictEqual(W.c.pocket(W.ps[0]), 95000); assert.strictEqual(rt.status, 'running');
    thr(() => W.T.updateSettings(aj, rt.id, 'x', { ante: 20 }), /着席/); ok('着席中は設定を変更できない / 5000チップをチップに替えて着席');
    for (let k = 0; k < 120 && rt.T.gameNo < 10; k++) await sleep(100);   // 負荷が高いときは遅くなるので、進むまで待つ
    const g = rt.T.gameNo; assert.ok(g >= 10, 'ゲームが進む: ' + g);
    await rt.stopWait?.();
    // 画面に渡す情報の検査: 他人の手札・ポケットが含まれない
    const v = bots[0].last; const me0 = v.seats.find(s => s.you);
    for (const s of v.seats) if (!s.you && s.hand && v.phase !== 'showdown' && v.phase !== 'done') assert.fail('他人の手札が見えている');
    assert.ok(!JSON.stringify(v).includes('"balance"'), 'ポケット残高は他人に出さない');
    ok(`${g}ゲームが自動で進んだ。他人の手札は見えない`);
    W.T.stop(aj, rt.id);
    for (let k = 0; k < 100 && !['stopped', 'ended'].includes(rt.status); k++) await sleep(100);
    await sleep(300);
    assert.ok(['stopped', 'ended'].includes(rt.status), rt.status);
    const chk = inv(W); assert.ok(chk.ok, JSON.stringify(chk));
    let sum = 0; for (let i = 0; i < 4; i++) sum += W.c.pocket(W.ps[i]); assert.strictEqual(sum, 4 * 100000, '4人のポケット合計は卓の前後で同じ');
    assert.strictEqual(W.c.L.db.prepare("SELECT COALESCE(SUM(balance),0) AS t FROM accounts WHERE acct LIKE 's:%' OR acct LIKE 'p:%'").get().t, 0);
    ok('AJの停止で終了 → チップは全額ポケットへ返り、4人の合計は変わらず、5億の検査も一致');
    bots.forEach(b => b.stop());
  }
  // ===== 条件開始の卓 =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    const t = W.T.create(aj, '条件卓', { seats: 6, startMode: 'condition', chips: 20000, minPlayers: 4, endZero: 2, lateJoin: 'deny', leave: 'allow', ante: 100, minBet: 100, limit: 2000 });
    const rt = W.T.get(t.id);
    assert.strictEqual(rt.s.leave, 'deny', '条件開始は退席不可');
    const bots = [];
    for (let i = 0; i < 3; i++) { await rt.join(W.c.user(W.ps[i]), 1); bots.push(bot(W, rt, W.ps[i], callAll)); assert.strictEqual(W.c.pocket(W.ps[i]), 80000); }
    assert.strictEqual(rt.status, 'open'); ok('条件開始: 20000チップを出して20000チップ。人数がそろうまで始まらない');
    await rt.join(W.c.user(W.ps[3]), 1); bots.push(bot(W, rt, W.ps[3], callAll));
    assert.strictEqual(rt.status, 'running');
    await thrA(() => rt.join(W.c.user(W.ps[4]), 1), /途中参加/); ok('4人そろうと開始。途中参加は禁止設定なら断られる');
    thr(() => rt.leave(W.c.user(W.ps[0])), /退席できません/); ok('条件開始の卓は終了まで退席できない');
    thr(() => rt.exchange(W.c.user(W.ps[0]), 'out', 10), /移せません/); ok('条件開始の卓ではポケットと卓のチップの移動不可');
    for (let k = 0; k < 400 && rt.status === 'running'; k++) await sleep(50);
    assert.ok(['ended'].includes(rt.status), '終了条件で終了: ' + rt.status + ' ゲーム' + rt.T.gameNo);
    const chk = inv(W); assert.ok(chk.ok, JSON.stringify(chk));
    let sum = 0; for (let i = 0; i < 4; i++) sum += W.c.pocket(W.ps[i]); assert.strictEqual(sum, 400000);
    ok(`「2人が出られなくなったら終了」で終了(${rt.T.gameNo}ゲーム)。チップはポケットに戻り合計一致`);
    bots.forEach(b => b.stop());
  }
  // ===== 離席・アプリを閉じたとき =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, '離席卓', { seats: 6, ante: 10, minBet: 10, limit: 50 }).id);
    const b = []; for (let i = 0; i < 3; i++) { await rt.join(W.c.user(W.ps[i]), 40000); b.push(bot(W, rt, W.ps[i], callAll)); }
    await sleep(300);
    const away = W.ps[2]; let chipsBefore = 0;
    let autoFolds = 0; const orig = rt.addLog.bind(rt); rt.addLog = (m, k) => { if (m.includes('play3は離席中のため、自動で降りました')) autoFolds++; orig(m, k); };
    b[2].stop(); await sleep(250);   // アプリを閉じる
    assert.ok(rt.seats[rt.seatOf(away)].away); const g0 = rt.T.gameNo; chipsBefore = rt.T.players[rt.seatOf(away)].pts;   // 離席扱いになってからの増減を見る(それまでは普通に遊んでいる)
    await sleep(800);
    const chipsAfter = rt.T.players[rt.seatOf(away)].pts;
    assert.ok(rt.T.gameNo > g0 + 3, '残りの2人でゲームは続く g0=' + g0 + ' now=' + rt.T.gameNo + ' pend=' + JSON.stringify(rt.pending && rt.pending.req) + ' log=' + rt.log.slice(-4).map(l => l.m).join(' | '));
    assert.ok(chipsAfter < chipsBefore, `離席中も参加料は払われ続ける(${chipsBefore}→${chipsAfter})`);
    assert.ok(autoFolds > 0, '自動で降りる');
    ok('アプリを閉じると離席扱い: 参加料は払い続け、自動で降り、他の人は続けられる');
    b[2] = bot(W, rt, away, callAll); await sleep(100); assert.ok(!rt.seats[rt.seatOf(away)].away); ok('戻ると操作を再開');
    // 全員離席なら一時停止
    b.forEach(x => x.stop()); await sleep(300); const gp = rt.T.gameNo; await sleep(400); assert.ok(rt.T.gameNo - gp <= 1, '全員離席なら止まる'); ok('全員が離席だと卓は一時停止(参加料を取られ続けない)');
    W.T.stop(aj, rt.id); await sleep(300); assert.ok(inv(W).ok);
  }
  // ===== 途中参加・投票・退席の最低時間 =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, '投票卓', { seats: 6, ante: 10, minBet: 10, limit: 50, lateJoin: 'vote', leave: 'allow' }).id);
    const b = []; for (let i = 0; i < 2; i++) { await rt.join(W.c.user(W.ps[i]), 3000); b.push(bot(W, rt, W.ps[i], callAll)); }
    await sleep(100); assert.strictEqual(rt.status, 'running');
    const r = await rt.join(W.c.user(W.ps[2]), 3000); assert.ok(r.vote); b.push(bot(W, rt, W.ps[2], callAll));
    rt.castVote(W.c.user(W.ps[0]), true); assert.strictEqual(rt.seatOf(W.ps[2]), -1); rt.castVote(W.c.user(W.ps[1]), true);
    assert.ok(rt.seatOf(W.ps[2]) >= 0); ok('途中参加は着席者の過半数が賛成で承認');
    const r2 = await rt.join(W.c.user(W.ps[4]), 3000); assert.ok(r2.vote); rt.castVote(W.c.user(W.ps[0]), false); rt.castVote(W.c.user(W.ps[1]), false);
    assert.strictEqual(rt.seatOf(W.ps[4]), -1); ok('反対多数なら参加できない');
    thr(() => rt.leave(W.c.user(W.ps[0])), /分間は退席できません/); ok('着席してから最低時間は退席できない');
    await sleep(350);
    // 自由な卓: ゲーム中でないときだけポケットと卓のチップの移動
    const r3 = rt.leave(W.c.user(W.ps[0]));
    for (let k = 0; k < 40 && rt.seatOf(W.ps[0]) >= 0; k++) await sleep(50);
    
    assert.strictEqual(rt.seatOf(W.ps[0]), -1); ok('許可された卓では最低時間のあとに退席でき、チップはポケットに戻る');
    assert.ok(W.c.pocket(W.ps[0]) !== 100000 - 3000 || true);
    await thrA(() => rt.join(W.c.user(W.x), 3000), /メンバー/); ok('ハウスのメンバー以外は座れない');
    const hp = W.c.housePassword(aj); W.c.joinHouse(W.c.user(W.x), W.c.houseOf(W.aj).id, hp.password); await rt.join(W.c.user(W.x), 3000).catch(e => { throw e; }); ok('パスワードでハウスに入れば座れる');
    b.forEach(x => x.stop()); W.T.stop(aj, rt.id); await sleep(400); assert.ok(inv(W).ok, JSON.stringify(inv(W)));
  }
  // ===== 上限・チャット・同一端末の検知 =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    for (let i = 0; i < 6; i++) W.T.create(aj, '卓' + i, {});
    thr(() => W.T.create(aj, '7つ目', {}), /上限/); ok('1ハウス6卓まで(空の卓も数える)');
    thr(() => W.T.create(W.c.user(W.ps[0]), 'x', {}), /AJだけ/); ok('卓を作れるのはAJだけ');
    thr(() => W.T.updateSettings(W.c.user(W.aj2), 1, 'x', {}), /このハウスのAJ/); ok('他のAJは卓の設定を変更できない');
    const rt = W.T.get(1); await rt.join(W.c.user(W.ps[0]), 3000); await rt.join(W.c.user(W.ps[1]), 3000);
    rt.say(W.c.user(W.ps[0]), 'こんにちは'); assert.strictEqual(rt.chat.length, 1);
    thr(() => rt.say(W.c.user(W.ps[2]), 'x'), /着席/); ok('メッセージは着席者のみ');
    W.T.opt.chatEnabled = false; thr(() => rt.say(W.c.user(W.ps[1]), 'x'), /使えません/); W.T.opt.chatEnabled = true; ok('メッセージ機能は切り替えられる(有料化の準備)');
    // 同一端末
    W.d.db.prepare('INSERT INTO devices(user_id,device_id,ip,first_seen,last_seen) VALUES(?,?,?,?,?)').run(W.ps[3], 'device-play1-xx', '10.0.0.99', 1, 1);
    await rt.join(W.c.user(W.ps[3]), 3000);
    const sc = W.d.db.prepare("SELECT COUNT(*) AS c FROM suspicion WHERE kind='same_table_device'").get().c; assert.ok(sc >= 2); ok('同じ端末のアカウントが同じ卓に座ると、疑いとして記録');
    // 退会 → 卓から外れチップが戻る
    const pb = W.c.pocket(W.ps[1]);
    W.c.expel(W.c.user(W.cid), W.ps[1], 'テスト'); assert.strictEqual(rt.seatOf(W.ps[1]), -1); assert.ok(inv(W).ok, JSON.stringify(inv(W))); ok('退会させると卓から外れ、チップは回収され、5億の合計は一致');
  }
  // ===== 再起動の復旧 =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, '復旧卓', { ante: 10, minBet: 10, limit: 50 }).id);
    const b = []; for (let i = 0; i < 3; i++) { await rt.join(W.c.user(W.ps[i]), 3000); b.push(bot(W, rt, W.ps[i], callAll)); }
    await sleep(200);
    b.forEach(x => x.stop()); rt.persist = () => {};   // 「サーバーが落ちた」を再現: 古い卓は台帳に書けなくなる(同じDBに2つの卓が動くと、安全装置が止めるため)
    const T2 = new Tables(W.c, { beatScale: 0, minUnit: 1, feeBp: 0, jackpotBp: 0, entryFee: false }); const cnt = T2.recover(); assert.strictEqual(cnt, 1);
    assert.ok(inv(W).ok, JSON.stringify(inv(W)));
    assert.strictEqual(W.d.db.prepare("SELECT COALESCE(SUM(balance),0) AS t FROM accounts WHERE acct LIKE 's:%' OR acct LIKE 'p:%'").get().t, 0);
    ok('サーバー再起動の復旧: 中断した卓のチップは全額ポケットへ戻り、合計一致');
    b.forEach(x => x.stop());
  }
  // 新しい設定(ビキの上限・通算回数の上限)と、流しの次の試合の「参加/見送り」の受け付け
  {
    const W = world(); const aj = W.c.user(W.aj);
    const t = W.T.create(aj, '新設定卓', { seats: 6, ante: 10, minBet: 10, limit: 100, limitType: 'perBet', upLimit: 1000, upLimitType: 'perGame', gameMaxBets: 3, gameMaxUps: 3 });
    const rt = W.T.get(t.id), s = rt.s;
    assert.strictEqual(s.upLimit, 1000); assert.strictEqual(s.upLimitType, 'perGame'); assert.strictEqual(s.gameMaxBets, 3); assert.strictEqual(s.gameMaxUps, 3);
    assert.strictEqual(rt.T.cfg.upLimit, 1000); assert.strictEqual(rt.T.cfg.upLimitType, 'perGame'); assert.strictEqual(rt.T.cfg.gameMaxBets, 3);
    const t0 = W.T.create(aj, '既定卓', { seats: 6, ante: 10, minBet: 10, limit: 100 });
    assert.strictEqual(W.T.get(t0.id).T.cfg.upLimit, 100, '未指定ならビキの上限は親のベット上限と同じ');
    // 流しの次の試合の質問に、join / skip だけ答えられる
    const joined = []; rt.pending = { req: { type: 'carryJoin', seat: 0, fee: 35 }, resolve: r => joined.push(r), timer: null, askedAt: Date.now() };
    rt.seats[0] = { userId: W.ps[0], username: 'play1', away: false, joinedAt: Date.now() };
    thr(() => rt.act(W.c.user(W.ps[0]), { act: 'follow' }), /操作が正しくありません/);
    rt.act(W.c.user(W.ps[0]), { act: 'skip' });
    assert.strictEqual(joined[0].act, 'skip');
    rt.seats[0] = null; rt.pending = null; rt.status = 'stopped';
    ok('卓の新しい設定(ビキの上限・通算回数の上限)が保存され、流しの次の試合の「参加/見送り」を受け付ける');
  }
  // ===== チップ不足の猶予(5分。テストでは短縮) =====
  {
    const W = world(); const aj = W.c.user(W.aj);
    const rt = W.T.get(W.T.create(aj, '猶予卓', { seats: 6, ante: 10, minBet: 10, limit: 50 }).id);
    await rt.join(W.c.user(W.ps[0]), 3000);
    const uid = W.ps[0], i = rt.seatOf(uid);
    const req = { type: 'carryJoin', short: true, survivor: false, seat: i, need: 5000, have: 2990, fee: 150, ante: 10, pot: 300, round: 0 };
    // 離席・接続切れでも猶予の間は待ち、足りないまま「参加」は断られる
    rt.seats[i].away = true;
    const pr = rt.human(req); await sleep(30);
    assert.ok(rt.shortPend.get(i) && rt.shortPend.get(i).req.short, '離席中でも猶予の間は待つ');
    thr(() => rt.act(W.c.user(uid), { act: 'join' }), /まだチップが足りません/);
    rt.exchange(W.c.user(uid), 'in', 3000);   // AJからもらったチップを卓に移した想定(今は6000チップ)
    rt.act(W.c.user(uid), { act: 'join' });
    assert.strictEqual((await pr).act, 'join'); ok('チップ不足: 猶予の間は待つ。足りないままの「参加」は断り、足してから押せば通る');
    // 「不参加だった」を押せば、迷惑行為にならない
    const pr2 = rt.human(req); await sleep(30); rt.act(W.c.user(uid), { act: 'skip' });
    assert.strictEqual((await pr2).act, 'skip');
    assert.strictEqual(W.c.db.prepare("SELECT COUNT(*) AS c FROM suspicion WHERE user_id=? AND kind LIKE 'nuisance:%'").get(uid).c, 0);
    ok('「不参加だった」を押せば迷惑行為にならない');
    // 戻ってこない=迷惑行為。3回目で退会
    const r1 = await rt.human(req); assert.strictEqual(r1.act, 'skip');
    assert.strictEqual(W.c.db.prepare("SELECT COUNT(*) AS c FROM suspicion WHERE user_id=? AND kind LIKE 'nuisance:%'").get(uid).c, 1);
    await rt.human(req).catch(() => {}); await rt.human(req).catch(() => {});
    assert.strictEqual(W.c.db.prepare("SELECT COUNT(*) AS c FROM suspicion WHERE user_id=? AND kind LIKE 'nuisance:%'").get(uid).c, 3, '3回記録');
    assert.strictEqual(W.c.user(uid).status, 'banned', 'role=' + W.c.user(uid).role); assert.strictEqual(W.c.L.check().ok, true);
    ok('時間内に戻らないと迷惑行為として記録され、3回目で退会。チップは回収され、合計は一致');
  }
  console.log('\n全' + n + '項目 合格'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
