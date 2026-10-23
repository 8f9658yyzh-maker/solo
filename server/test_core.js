'use strict';
const assert = require('node:assert');
const D = require('./db'); const { Core } = require('./core');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const thr = (f, re) => { try { f(); } catch (e) { if (re && !re.test(e.message)) throw new Error('違うエラー: ' + e.message); return; } throw new Error('エラーになるはずが成功した'); };

const d = D.open(':memory:'), c = new Core(d);
const cid = c.bootstrap('kaito', 'password-1', '09000000001');
const me = c.user(cid);
assert.strictEqual(c.L.check().ok, true); assert.strictEqual(c.pocket(cid), 500000000); ok('作成者のポケットに5億。合計検査OK');

const mk = (by, role, name, phone, dev, ip) => { const inv = c.createInvite(c.user(by), role); return c.signup({ invite: inv.code, username: name, password: 'password-' + name, phone, deviceId: dev, ip: ip || '1.1.1.' + n }).id; };
const sov = mk(cid, 'sovereign', 'touhatsu', '09000000002', 'dev-sov-0001');
const man = mk(sov, 'manager', 'kanri', '09000000003', 'dev-man-0001');
const aj1 = mk(man, 'aj', 'aj_one', '09000000004', 'dev-aj1-0001');
const aj2 = mk(man, 'aj', 'aj_two', '09000000005', 'dev-aj2-0001');
const p1 = mk(aj1, 'player', 'player1', '09000000006', 'dev-p1-00001', '2.2.2.2');
const p2 = mk(aj1, 'player', 'player2', '09000000007', 'dev-p2-00001');
const p3 = mk(aj2, 'player', 'player3', '09000000008', 'dev-p3-00001');
ok('5つの立場のアカウントを招待で作成(直のAJが親になる)');
assert.strictEqual(c.user(p1).parent_id, aj1); assert.strictEqual(c.homeHouseId(c.user(p1)), c.houseOf(aj1).id);

// 招待できない組み合わせ
thr(() => c.createInvite(c.user(aj1), 'aj'), /招待できません/); thr(() => c.createInvite(c.user(p1), 'player'), /招待できません/); thr(() => c.createInvite(c.user(man), 'player'), /招待できません/);
ok('AJはAJを招待できない・プレイヤーは招待できない・管理責任者は直接プレイヤーを作れない');

// 1人1アカウント
const inv = c.createInvite(c.user(aj1), 'player');
thr(() => c.signup({ invite: inv.code, username: 'dup1', password: 'password-dup', phone: '090-0000-0006', deviceId: 'dev-other-001', ip: '9.9.9.9' }), /電話番号/);
thr(() => c.signup({ invite: inv.code, username: 'dup2', password: 'password-dup', phone: '09011112222', deviceId: 'dev-p1-00001', ip: '9.9.9.9' }), /端末/);
ok('同じ電話番号・同じ端末では2つ目のアカウントを作れない');
thr(() => c.signup({ invite: 'ZZZZZZ', username: 'x1x', password: 'password-x', phone: '09099998888', deviceId: 'dev-new-0001' }), /招待/);
c.signup({ invite: inv.code, username: 'ok_new', password: 'password-ok', phone: '09033334444', deviceId: 'dev-new-0002', ip: '5.5.5.5' });
thr(() => c.signup({ invite: inv.code, username: 'ok_new2', password: 'password-ok', phone: '09033335555', deviceId: 'dev-new-0003', ip: '5.5.5.5' }), /招待/);
ok('招待コードは1回きり');

// チップの配布・回収の権限
thr(() => c.give(me, sov, 10), /共有/); ok('作成者と統括責任者のポケットは共有(渡し合いはできない)');
c.give(c.user(sov), man, 50000000);
c.give(c.user(man), aj1, 1000000); c.give(c.user(man), aj2, 1000000);
c.give(c.user(aj1), p1, 50000); c.give(c.user(aj1), p2, 50000); c.give(c.user(aj2), p3, 50000);
thr(() => c.give(c.user(aj1), p3, 10), /渡せません/); ok('AJは別のAJの配下に渡せない');
thr(() => c.give(c.user(p1), p2, 10), /渡せません/); ok('プレイヤーは渡せない(受け取り専用)');
thr(() => c.give(c.user(man), p1, 10), /渡せません/); ok('管理責任者は自分のポケットから配るのはAJまで');
thr(() => c.pull(c.user(aj1), man, 10), /引き取れません/); thr(() => c.pull(c.user(aj1), p3, 10), /引き取れません/); thr(() => c.pull(c.user(man), cid, 10), /引き取れません/); thr(() => c.pull(c.user(man), sov, 10), /引き取れません/);
ok('下位は上位のポケットに触れない / AJは他AJのプレイヤーに触れない');
c.pull(c.user(aj1), p1, 20000); assert.strictEqual(c.pocket(p1), 30000);
c.pull(c.user(man), p3, 1000); c.pull(me, p1, 1); c.pull(c.user(sov), man, 5);
ok('AJ→直のプレイヤー、管理→配下全員、作成者・統括→下位 は引き取れる');
thr(() => c.give(c.user(aj1), p1, 999999999), /足りません/); thr(() => c.give(c.user(aj1), p1, -5), /整数/); thr(() => c.give(c.user(aj1), p1, 1.5), /整数/);
assert.strictEqual(c.L.check().ok, true, JSON.stringify(c.L.check())); ok('不正な額は拒否。5億の合計は変わらない');

// 履歴の見え方: AJ_twoの記録はAJ_oneに見えない
const h1 = c.myLedger(c.user(aj1)).map(r => r.counter).join('|'), h2 = c.myLedger(c.user(p3)).map(r => r.counter + (r.by || '')).join('|');
assert.ok(!h1.includes('player3')); assert.ok(h2.includes('kanri') || h2.includes('aj_two')); ok('介入記録は当事者にしか見えない');
assert.strictEqual(c.visibleUsers(c.user(aj1)).length, 3); assert.ok(c.visibleUsers(c.user(aj1)).every(u => u.parent_id === aj1)); assert.strictEqual(c.visibleUsers(c.user(p1)).length, 0);
ok('AJは直のプレイヤーだけ、プレイヤーは誰も見えない');
thr(() => { d.db.exec('DELETE FROM ledger'); }, /削除できません/); thr(() => { d.db.exec('UPDATE ledger SET delta=1'); }, /書き換え/); ok('台帳の書き換え・削除は禁止(トリガー)');

// 総量変更は作成者だけ
thr(() => c.L.changeSupply(sov, 1), /./) ; 
c.L.changeSupply(cid, 600000000); assert.strictEqual(c.L.check().ok, true); assert.strictEqual(c.L.supply(), 600000000); ok('総量の変更は作成者のみ。変更後も合計一致');

// ハウス
const hp = c.housePassword(c.user(aj1)); assert.strictEqual(hp.password.length, 6);
const hid = c.houseOf(aj1).id;
thr(() => c.joinHouse(c.user(p3), hid, '000000'), /違う/); 
c.joinHouse(c.user(p3), hid, hp.password); assert.ok(c.isMember(p3, hid)); ok('他AJのハウスにはIDとパスワードで入れる');
assert.strictEqual(c.myHouses(c.user(p3)).length, 2);
c.kickFromHouse(c.user(aj1), p3); assert.ok(!c.isMember(p3, hid)); ok('AJは入ってきたプレイヤーを外せる');
thr(() => c.kickFromHouse(c.user(aj1), p1), /直/); thr(() => c.kickFromHouse(c.user(aj2), p1), /./);
// 5分で期限切れ → 再生成
d.db.prepare('UPDATE houses SET pass_exp=? WHERE id=?').run(Date.now() - 1, hid);
thr(() => c.joinHouse(c.user(p2), hid, hp.password), /期限|違う/);
const hp2 = c.housePassword(c.user(aj1)); assert.notStrictEqual(hp2.password, hp.password); ok('パスワードは期限後に作り直される/古いものは使えない');
// 総当たり制限
const c2 = new Core(D.open(':memory:'), { JOIN_MAX_TRIES: 3 }); c2.bootstrap('adm', 'password-1', '09000000011');
const m2 = c2.signup({ invite: c2.createInvite(c2.user(1), 'aj').code, username: 'ajx', password: 'password-x', phone: '09000000012', deviceId: 'dev-xxxx-0001', ip: '1.1.1.1' }).id;
const q2 = c2.signup({ invite: c2.createInvite(c2.user(1), 'player').code, username: 'plx', password: 'password-x', phone: '09000000013', deviceId: 'dev-xxxx-0002', ip: '1.1.1.2' }).id;
for (let i = 0; i < 3; i++) thr(() => c2.joinHouse(c2.user(q2), c2.houseOf(m2).id, '123456'), /違う/);
thr(() => c2.joinHouse(c2.user(q2), c2.houseOf(m2).id, '123456'), /試行回数/); ok('パスワードの総当たりは回数制限');

// 通報・監視・退会・IP
c.report(c.user(p2), p1, null, 'test'); c.report(c.user(p3), p1, null, 'test');
assert.strictEqual(c.user(p1).status, 'active');
c.report(c.user(aj1), p1, null, 'test'); assert.strictEqual(c.user(p1).status, 'watch');
assert.ok(c.notifications(me).some(n => n.kind === 'watch') && c.notifications(c.user(sov)).some(n => n.kind === 'watch')); ok('3人の通報で監視対象になり、作成者と統括に通知');
thr(() => c.report(c.user(p2), p1, null, 'again'), /1日1回/);
thr(() => c.expel(c.user(man), p1, 'x'), /権限|できます|退会させられます|許可できます/); thr(() => c.expel(c.user(aj1), p1, 'x'), /権限|できます|退会させられます|許可できます/);
const before = c.pocket(aj1);
c.login({ username: 'player1', password: 'password-player1', deviceId: 'dev-p1-00001', ip: '2.2.2.2' });
const pb = c.pocket(p1);
c.expel(c.user(sov), p1, '不正を確認'); assert.strictEqual(c.user(p1).status, 'banned'); assert.strictEqual(c.pocket(p1), 0); assert.strictEqual(c.pocket(aj1), before + pb);
assert.strictEqual(c.L.check().ok, true); ok('退会: チップは直のAJへ返還、総量は不変');
thr(() => c.login({ username: 'player1', password: 'password-player1', deviceId: 'dev-p1-00001', ip: '2.2.2.2' }), /退会/);
thr(() => c.signup({ invite: c.createInvite(c.user(aj1), 'player').code, username: 'newbie', password: 'password-new', phone: '09055556666', deviceId: 'dev-newb-0001', ip: '2.2.2.2' }), /許可/); ok('退会者のIPからは登録・ログイン不可');
c.permitIp(c.user(sov), '2.2.2.2', 'newbie');
c.signup({ invite: c.createInvite(c.user(aj1), 'player').code, username: 'newbie', password: 'password-new', phone: '09055556666', deviceId: 'dev-newb-0001', ip: '2.2.2.2' }); ok('作成者・統括の許可があれば通れる');
thr(() => c.permitIp(c.user(man), '2.2.2.2', 'zzz'), /権限|できます|退会させられます|許可できます/); ok('IP許可は作成者・統括のみ');

// 要チェック
for (let i = 0; i < 5; i++) c.suspect(p2, 'test', {});
assert.ok(c.notifications(c.user(man)).some(n => n.kind === 'check') && c.notifications(me).some(n => n.kind === 'check')); ok('疑わしい行動が5回で「要チェック」が管理責任者・作成者・統括に届く');
assert.ok(c.sharedDevices(c.user(man)).length >= 0); thr(() => c.sharedDevices(c.user(aj1)), /権限/); ok('同じ端末・IP一覧は管理責任者以上のみ');
// 卓上限申請
const rid = c.requestLimit(c.user(aj1), '人が増えた'); assert.strictEqual(c.listLimitRequests(c.user(man)).length, 1); c.forwardLimit(c.user(man), rid); assert.strictEqual(c.listLimitRequests(c.user(sov)).length, 1); c.decideLimit(c.user(sov), rid, 10, true);
assert.strictEqual(c.houseOf(aj1).table_limit, 10); ok('卓の上限: AJ→管理責任者→統括で上がる');
// 迷惑行為(流れた試合の不参加で戻らない): 3回目で自動退会、チップは直のAJへ
{
  const r1 = c.nuisance(p2, 'carry_noshow', {}); const r2 = c.nuisance(p2, 'carry_noshow', {});
  assert.deepStrictEqual([r1.count, r1.expelled, r2.count, r2.expelled], [1, false, 2, false]); assert.strictEqual(c.user(p2).status, 'active');
  const bal = c.pocket(p2), ajb = c.pocket(aj1);
  const r3 = c.nuisance(p2, 'carry_noshow', {});
  assert.deepStrictEqual([r3.count, r3.expelled], [3, true]); assert.strictEqual(c.user(p2).status, 'banned'); assert.strictEqual(c.pocket(aj1), ajb + bal);
  assert.strictEqual(c.L.check().ok, true);
  ok('迷惑行為は3回目で自動退会。チップは直のAJへ返り、総量は不変');
}
{ // 作成者・統括責任者・ゲーム管理責任者は、複数の端末(iPhone・iPad・Mac)から同時に使える。疑いにも数えない。プレイヤーは数える
  const before = c.db.prepare('SELECT COUNT(*) AS n FROM suspicion').get().n;
  const toks = ['dev-iphone-001', 'dev-ipad-0001', 'dev-mac-00001'].map(dv => c.login({ username: 'kaito', password: 'password-1', deviceId: dv, ip: '8.8.8.' + dv.length }).token);
  toks.push(c.login({ username: 'touhatsu', password: 'password-touhatsu', deviceId: 'dev-mac-00001', ip: '8.8.8.8' }).token);   // 作成者と同じMacで統括責任者
  toks.push(c.login({ username: 'kanri', password: 'password-kanri', deviceId: 'dev-mac-00001', ip: '8.8.8.8' }).token);
  assert.ok(toks.every(t => c.auth(t)), '全部の端末で同時にログインできる');
  assert.strictEqual(c.db.prepare('SELECT COUNT(*) AS n FROM suspicion').get().n, before, '管理側の複数端末は疑いに数えない');
  assert.ok(!c.sharedDevices(c.user(cid)).some(r => /kaito|touhatsu|kanri/.test(r.users)), '共有の一覧にも出さない');
  c.login({ username: 'ok_new', password: 'password-ok', deviceId: 'dev-p1-00001', ip: '6.6.6.6' });   // プレイヤーが他人の端末で入った
  assert.ok(c.db.prepare('SELECT COUNT(*) AS n FROM suspicion').get().n > before, 'プレイヤーの共有端末は疑いに数える');
  ok('管理側(作成者・統括責任者・ゲーム管理責任者)は複数の端末で同時に使え、疑いに数えない。プレイヤーの端末共有は従来どおり数える');
}
assert.strictEqual(c.L.check().ok, true);
console.log('\n全' + n + '項目 合格');
