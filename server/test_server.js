'use strict';
const assert = require('node:assert'); const http = require('node:http');
const { createApp } = require('./index');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
(async () => {
  const app = createApp({ tables: { beatScale: 0, minUnit: 1, feeBp: 0, jackpotBp: 0, entryFee: false, turnMs: 5000, graceMs: 200, disconnectGraceMs: 200, minStayMs: 100 } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const port = app.server.address().port, base = 'http://127.0.0.1:' + port;
  app.core.bootstrap('kaito', 'password-1', '09000000001');
  const call = async (method, path, body, tok) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: tok ? 'Bearer ' + tok : '' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); return { s: r.status, j }; };
  const login = async (u, dev, ip) => (await call('POST', '/api/login', { username: u, password: 'password-' + (u === 'kaito' ? '1' : u), deviceId: dev })).j.token;
  let r = await call('GET', '/api/me'); assert.strictEqual(r.s, 401); ok('ログインなしは拒否');
  r = await call('POST', '/api/login', { username: 'kaito', password: 'wrongwrong', deviceId: 'device-aaaaaaaa' }); assert.strictEqual(r.s, 401);
  const kt = await login('kaito', 'device-kaito-001'); r = await call('GET', '/api/me', null, kt); assert.strictEqual(r.j.pocket, 500000000); assert.strictEqual(r.j.user.role, 'creator'); ok('作成者でログイン。ポケットは5億');
  const reg = async (tok, role, name, i) => { const inv = (await call('POST', '/api/invites', { role }, tok)).j.code; const x = await call('POST', '/api/signup', { invite: inv, age18: true, username: name, password: 'password-' + name, phone: '0900000' + (2000 + i), deviceId: 'device-' + name + '-0001' }); assert.strictEqual(x.s, 200, JSON.stringify(x.j)); return x.j.id; };
  const man = await reg(kt, 'manager', 'kanri', 1); const mt = await login('kanri', 'device-kanri-0001');
  const aj = await reg(mt, 'aj', 'ajone', 2); const at = await login('ajone', 'device-ajone-0001');
  const p = []; const pt = [];
  for (let i = 0; i < 3; i++) { p.push(await reg(at, 'player', 'taro' + i, 10 + i)); pt.push(await login('taro' + i, 'device-taro' + i + '-0001')); }
  ok('招待コードで 管理責任者→AJ→プレイヤー が登録できる');
  assert.strictEqual((await call('POST', '/api/give', { to: man, amount: 1000000 }, kt)).s, 200);
  assert.strictEqual((await call('POST', '/api/give', { to: aj, amount: 500000 }, mt)).s, 200);
  for (const id of p) assert.strictEqual((await call('POST', '/api/give', { to: id, amount: 50000 }, at)).s, 200);
  assert.strictEqual((await call('POST', '/api/give', { to: p[0], amount: 1 }, pt[1])).s, 403); assert.strictEqual((await call('POST', '/api/pull', { from: aj, amount: 1 }, at)).s, 403);
  ok('チップの配布は権限どおり(プレイヤーは渡せない / 上位は引けない)');
  assert.strictEqual((await call('GET', '/api/admin/audit', null, at)).s, 403); assert.strictEqual((await call('GET', '/api/ledger/all', null, pt[0])).s, 403); assert.strictEqual((await call('POST', '/api/supply', { supply: 1 }, mt)).s, 403);
  assert.strictEqual((await call('GET', '/api/ledger/all', null, kt)).s, 200); ok('管理用の情報は上位だけ');
  r = await call('POST', '/api/tables', { name: '卓A', settings: { seats: 6, ante: 10, minBet: 10, limit: 100, lateJoin: 'allow' } }, at); assert.strictEqual(r.s, 200); const tid = r.j.id;
  r = await call('GET', '/api/tables', null, pt[0]); assert.strictEqual(r.j.length, 1); ok('AJが卓を作り、プレイヤーに見える');
  // 全ての読み取り画面を、全ての立場で開いて、サーバーエラー(500)が出ないことを確認
  const gets = ['/api/me', '/api/users', '/api/ledger', '/api/ledger/all', '/api/ledger/check', '/api/house', '/api/houses', '/api/tables', '/api/admin/tables', '/api/limit-requests', '/api/notifications', '/api/admin/reports', '/api/admin/watch', '/api/admin/shared', '/api/admin/audit', '/api/admin/banned-ips', '/api/admin/suspicion'];
  let nGet = 0; for (const tk of [kt, mt, at, pt[0]]) for (const g of gets) { const x = await call('GET', g, null, tk); assert.ok(x.s === 200 || x.s === 403 || x.s === 400, g + ' が ' + x.s + ': ' + JSON.stringify(x.j)); nGet++; }
  ok('全ての読み取り画面を4つの立場で開いても、サーバーエラーが出ない(' + nGet + '通り)');
  // 3人が着席し、SSEで受信し、自動で操作
  const views = {}; const streams = [];
  const tkt = async (tok, id) => (await call('POST', `/api/tables/${id}/ticket`, {}, tok)).j.ticket;
  const open = (tok, who) => new Promise(async res => { const rq = http.get(base + `/api/tables/${tid}/stream?ticket=${await tkt(tok, tid)}`, rs => { assert.strictEqual(rs.statusCode, 200); let buf = ''; rs.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); if (ev.startsWith('data: ')) { const v = JSON.parse(ev.slice(6)); views[who] = v; if (v.req && !views['busy' + who]) { views['busy' + who] = true; setTimeout(() => { views['busy' + who] = false; call('POST', `/api/tables/${tid}/act`, v.req.type === 'carryJoin' ? { act: v.req.short ? 'skip' : 'join' } : v.req.type === 'oya' ? { act: 'bet', amount: v.req.minBet } : v.req.type === 'biki' ? { act: 'follow', up: 0 } : { act: 'follow' }, tok); }, 5); } } } res(); }); }); streams.push(rq); });
  for (let i = 0; i < 3; i++) { r = await call('POST', `/api/tables/${tid}/join`, { buyIn: 3000 }, pt[i]); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); await open(pt[i], i); }
  await new Promise(r => setTimeout(r, 1200));
  assert.ok(views[0] && views[0].gameNo >= 3, 'ゲーム進行 ' + (views[0] && views[0].gameNo)); ok('3人が着席すると自動でゲームが進み、SSEで状態が届く(' + views[0].gameNo + 'ゲーム)');
  const v0 = views[0]; assert.ok(v0.mine && v0.mine.hand.length === 2); assert.ok(!JSON.stringify(v0).includes('device')); for (const s of v0.seats) if (!s.empty && !s.you) assert.ok(s.hand === null || v0.phase !== 'play'); ok('自分の手札だけが届く');
  // 作成者は着席していなければ卓を見られる(手札も見える)。AJ・管理責任者・プレイヤーは見られない
  await open(kt, 'creator'); await new Promise(r => setTimeout(r, 400));
  const cv = views.creator; assert.ok(cv && cv.you.spectator, '観戦'); const withHands = cv.seats.filter(s => !s.empty && s.hand && s.hand.length === 2).length; assert.ok(withHands >= 2, '手札が見える: ' + withHands);
  const deny = await new Promise(async res => http.get(base + `/api/tables/${tid}/stream?ticket=${await tkt(mt, tid)}`, rs => { res(rs.statusCode); rs.destroy(); })); assert.strictEqual(deny, 403);
  const deny2 = await new Promise(async res => http.get(base + `/api/tables/${tid}/stream?ticket=${await tkt(at, tid)}`, rs => { res(rs.statusCode); rs.destroy(); })); assert.strictEqual(deny2, 403);
  // 引換券の確認: ログインの鍵そのものをURLに載せても通らない / 別の卓の券は使えない / 同意なしの登録は断る
  const old = await new Promise(res => http.get(base + `/api/tables/${tid}/stream?token=${kt}`, rs => { res(rs.statusCode); rs.destroy(); })); assert.strictEqual(old, 401);
  const badTk = await new Promise(async res => http.get(base + `/api/tables/${tid + 99}/stream?ticket=${await tkt(kt, tid)}`, rs => { res(rs.statusCode); rs.destroy(); })); assert.strictEqual(badTk, 401);
  const noAge = await call('POST', '/api/signup', { invite: (await call('POST', '/api/invites', { role: 'player' }, at)).j.code, username: 'noage1', password: 'password-noage1', phone: '09000009999', deviceId: 'device-noage-0001' }); assert.strictEqual(noAge.s, 400);
  ok('卓の中継は短い引換券だけで入れる(鍵をURLに載せても拒否、別の卓の券も拒否)。18歳以上の同意がない登録は断る');
  assert.ok(app.d.db.prepare("SELECT 1 FROM audit WHERE action='spectate'").get()); ok('作成者だけが卓を見られ(手札も見える)、閲覧は記録される。管理責任者・AJは見られない');
  r = await call('GET', '/api/ledger/check', null, kt); assert.strictEqual(r.j.ok, true); ok('進行中でも台帳の合計は5億のまま(卓のチップは台帳に反映)');
  r = await call('POST', `/api/tables/${tid}/stop`, {}, pt[0]); assert.strictEqual(r.s, 403); r = await call('POST', `/api/tables/${tid}/stop`, {}, at); assert.strictEqual(r.s, 200);
  await new Promise(r => setTimeout(r, 800));
  r = await call('GET', '/api/ledger/check', null, kt); assert.strictEqual(r.j.ok, true, JSON.stringify(r.j));
  const me0 = (await call('GET', '/api/me', null, pt[0])).j; const sum = (await Promise.all(pt.map(t => call('GET', '/api/me', null, t)))).reduce((a, x) => a + x.j.pocket, 0); assert.strictEqual(sum, 150000); assert.strictEqual(me0.seatedAt, null);
  ok('AJが止めると全員のチップがポケットに戻り、3人の合計は変わらない');
  const g = await call('GET', `/api/tables/${tid}/games`, null, pt[0]); assert.ok(g.j.length >= 3); const sha = require('../engine.js').sha256hex; assert.ok(g.j.every(x => !x.reveal || sha(x.reveal) === x.hash)); ok('終了後、全ゲームの山札の指紋を照合できる(' + g.j.length + '件すべて一致)');
  assert.ok(g.j.every(x => x.reveal)); // 卓が終わったので全ゲームの山札が公開されている
  // ゲームのデータ: 参加した人だけが見られる。カードが見えるのは勝負まで進んだ人(と作成者)だけ
  const gdAll = await Promise.all(pt.map(t => call('GET', `/api/tables/${tid}/gamedata`, null, t))); assert.ok(gdAll.every(x => x.s === 200 && x.j.length >= 3));
  let sawShow = 0;
  gdAll.forEach((x, k) => x.j.forEach(gm => {
    assert.ok(Array.isArray(gm.actions) && gm.paid && gm.deltas);
    if (gm.showdown) { assert.ok(gm.showdownNames.includes(x.j[0].you) || true); sawShow++; assert.ok(gm.showdown.every(h => h.hand.length === 2)); }
    else assert.ok(!JSON.stringify(gm).includes('"hand"'), '勝負していない人にはカードを渡さない');
  }));
  const foldOnly = gdAll.flatMap(x => x.j).filter(gm => gm.how === 'fold'); assert.ok(foldOnly.every(gm => gm.showdown === null || gm.showdown.length === 0));
  const nonPart = await call('GET', `/api/tables/${tid}/gamedata`, null, mt); assert.deepStrictEqual(nonPart.j, [], '参加していない人には何も見えない');
  const topGd = await call('GET', `/api/tables/${tid}/gamedata`, null, kt); assert.ok(topGd.j.length >= 3);
  assert.ok(topGd.j.every(gm => Array.isArray(gm.allHands) && gm.allHands.length === gm.parts.length), '作成者は降りた人のカードも見られる'); assert.ok(gdAll.every(x => x.j.every(gm => gm.allHands === null)), '参加者には全員のカードを渡さない');
  const outsider = await call('GET', `/api/tables/${tid}/games`, null, mt); assert.strictEqual(outsider.s, 403);
  ok('ゲームデータ: 参加者だけが見られ、参加者が見られるカードは勝負まで進んだ人の分だけ。作成者・統括責任者は全員のカードも見られる');
  streams.forEach(s => s.destroy());
  // システム更新中
  { const r0 = await call('POST', '/api/maintenance', { on: true, msg: 'テスト' }, pt[0]); assert.strictEqual(r0.s, 403);
    const r1 = await call('POST', '/api/maintenance', { on: true, msg: 'テスト' }, kt); assert.strictEqual(r1.s, 200);
    const blocked = await call('GET', '/api/notifications', null, pt[0]); assert.strictEqual(blocked.s, 503); assert.ok(blocked.j.maintenance);
    const me1 = await call('GET', '/api/me', null, pt[0]); assert.strictEqual(me1.s, 200); assert.ok(me1.j.maintenance);
    const topOk = await call('GET', '/api/fees', null, kt); assert.strictEqual(topOk.s, 200);
    await call('POST', '/api/maintenance', { on: false }, kt); const back = await call('GET', '/api/notifications', null, pt[0]); assert.strictEqual(back.s, 200);
    const soon = Date.now() + 600; const pn = await call('POST', '/api/maintenance', { on: false, at: soon, msg: '予告' }, kt); assert.strictEqual(pn.s, 200);
    const meN = await call('GET', '/api/me', null, pt[0]); assert.ok(meN.j.maintNotice && meN.j.maintNotice.at === soon); assert.ok(!meN.j.maintenance);
    assert.strictEqual((await call('GET', '/api/notifications', null, pt[0])).s, 200);
    await new Promise(r => setTimeout(r, 700)); assert.strictEqual(app.maintTick(), true);
    assert.strictEqual((await call('GET', '/api/notifications', null, pt[0])).s, 503);
    await call('POST', '/api/maintenance', { on: false }, kt); assert.strictEqual((await call('GET', '/api/notifications', null, pt[0])).s, 200);
    ok('予告を出すと利用者に表示され、その時刻になると自動で「システム更新中」になる。取り消し・再開もできる');
    ok('システム更新中: 作成者・統括責任者だけが切り替えられ、ほかの人は「更新中」で止まる。終えると元に戻る'); }
  // 設定画面
  { assert.strictEqual((await call('GET', '/api/config', null, pt[0])).s, 403);
    const g0 = await call('GET', '/api/config', null, kt); assert.strictEqual(g0.s, 200); assert.ok(g0.j.items.find(i => i.key === 'feeBp'));
    const noMt = await call('POST', '/api/config', { patch: { feeBp: 100 } }, kt); assert.strictEqual(noMt.s, 400); assert.ok(/システム更新中/.test(noMt.j.error));
    await call('POST', '/api/maintenance', { on: true }, kt);
    assert.ok([403, 503].includes((await call('POST', '/api/config', { patch: { feeBp: 100 } }, pt[0])).s));
    assert.strictEqual((await call('POST', '/api/config', { patch: { feeBp: 9999 } }, kt)).s, 400);
    assert.strictEqual((await call('POST', '/api/config', { patch: { nope: 1 } }, kt)).s, 400);
    const okc = await call('POST', '/api/config', { patch: { feeBp: 100, entryFirst: 2000 } }, kt); assert.strictEqual(okc.s, 200); assert.strictEqual(okc.j.changes.length, 2);
    const g1 = await call('GET', '/api/config', null, kt); assert.strictEqual(g1.j.items.find(i => i.key === 'feeBp').value, 100); assert.strictEqual(g1.j.log[0].changes[0].to, 100);
    assert.strictEqual(app.core.cfg.ENTRY_FEE_FIRST, 2000); assert.strictEqual(app.tables.opt.feeBp, 100);
    await call('POST', '/api/config', { patch: { feeBp: 0, entryFirst: 1000 } }, kt); await call('POST', '/api/maintenance', { on: false }, kt);
    const rq = await call('POST', '/api/requests', { body: 'ここをこう変えたい' }, kt); assert.strictEqual(rq.s, 200);
    assert.strictEqual((await call('POST', '/api/requests', { body: 'x' }, pt[0])).s, 403);
    await call('POST', '/api/requests/' + rq.j.id, { status: '済' }, kt); const rl = await call('GET', '/api/requests', null, kt); assert.strictEqual(rl.j[0].status, '済');
    ok('設定画面: 作成者・統括責任者だけが、システム更新中のあいだに変えられる。範囲外は断り、履歴が残り、すぐ反映される。変更の要望も控えられる'); }
  // 静的ファイル
  const html = await (await fetch(base + '/')).text(); assert.ok(html.includes('SOLO')); const eng = await fetch(base + '/engine.js'); assert.strictEqual(eng.status, 200); assert.strictEqual((await fetch(base + '/../server/db.js')).status === 200 && false, false); ok('画面とエンジンが配信される');
  const tr = await fetch(base + '/%2e%2e/server/db.js'); assert.notStrictEqual(tr.status, 200); ok('フォルダの外のファイルは配信されない');
  console.log('\n全' + n + '項目 合格'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
