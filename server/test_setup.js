'use strict';
// 最初の設定(作成者を画面から作る)のテスト
const assert = require('node:assert');
const { createApp } = require('./index');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
(async () => {
  const start = async opts => { const app = createApp(Object.assign({ tables: { beatScale: 0 } }, opts)); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); return app; };
  const call = async (app, method, path, body) => { const r = await fetch('http://127.0.0.1:' + app.server.address().port + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  // 合言葉がない・短いときは、最初の設定を受け付けない
  for (const code of [undefined, 'short']) {
    const app = await start({ setupCode: code });
    let r = await call(app, 'GET', '/api/setup'); assert.strictEqual(r.j.needed, false);
    r = await call(app, 'POST', '/api/setup', { code: 'short', username: 'kaito', password: 'password-1', phone: '09000000001' }); assert.strictEqual(r.s, 400);
    app.server.close();
  }
  ok('合言葉が設定されていない(8文字未満も)ときは、誰も作成者を作れない');
  const app = await start({ setupCode: 'umi-no-iro-2026' });
  let r = await call(app, 'GET', '/api/setup'); assert.strictEqual(r.j.needed, true);
  r = await call(app, 'POST', '/api/setup', { code: 'umi-no-iro-2025', username: 'kaito', password: 'password-1', phone: '09000000001' }); assert.strictEqual(r.s, 403);
  r = await call(app, 'POST', '/api/setup', { code: 'umi-no-iro-2026', username: 'kaito', password: 'short', phone: '09000000001' }); assert.strictEqual(r.s, 400, 'パスワードが短いと作らない');
  r = await call(app, 'POST', '/api/setup', { code: 'umi-no-iro-2026', username: 'kaito', password: 'password-1', phone: '09000000001' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  const me = app.core.userByName('kaito'); assert.strictEqual(me.role, 'creator'); assert.strictEqual(app.core.pocket(me.id), 500000000);
  r = await call(app, 'GET', '/api/setup'); assert.strictEqual(r.j.needed, false);
  r = await call(app, 'POST', '/api/setup', { code: 'umi-no-iro-2026', username: 'second', password: 'password-1', phone: '09000000002' }); assert.strictEqual(r.s, 400, '2回目は作れない');
  r = await call(app, 'POST', '/api/login', { username: 'kaito', password: 'password-1', deviceId: 'device-kaito-0001' }); assert.ok(r.j.token);
  ok('正しい合言葉で1回だけ作成者を作れ、5億チップが入り、そのままログインできる。違う合言葉・短いパスワードは断る');
  app.server.close();
  const app2 = await start({ setupCode: 'umi-no-iro-2026' });
  for (let i = 0; i < 5; i++) await call(app2, 'POST', '/api/setup', { code: 'wrong-code-' + i });
  r = await call(app2, 'POST', '/api/setup', { code: 'umi-no-iro-2026', username: 'kaito', password: 'password-1', phone: '09000000001' }); assert.strictEqual(r.s, 429, '何度も試すと止まる');
  ok('合言葉の当てずっぽうは、10分に5回までで止まる');
  app2.server.close();
  // パスワードの再設定
  {
    const app3 = await start({});
    const c = app3.core, cid = c.bootstrap('kaito', 'password-1', '09000000001');
    const mk = (by, role, name, i) => c.signup({ invite: c.createInvite(c.user(by), role).code, username: name, password: 'password-' + name, phone: '0900000' + (2000 + i), deviceId: 'device-' + name + '-0001', ip: '10.0.0.' + i }).id;
    const sov = mk(cid, 'sovereign', 'touhatsu', 1), man = mk(cid, 'manager', 'kanri', 2), aj = mk(man, 'aj', 'aj_one', 3), pl = mk(aj, 'player', 'taro', 4), pl2 = mk(aj, 'player', 'hana', 5);
    const aj2 = mk(man, 'aj', 'aj_two', 6);
    const tok = async (name, pw) => (await call(app3, 'POST', '/api/login', { username: name, password: pw, deviceId: 'device-' + name + '-0001' })).j.token;
    const callT = async (method, path, body, t) => { const r = await fetch('http://127.0.0.1:' + app3.server.address().port + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const at = await tok('aj_one', 'password-aj_one'), at2 = await tok('aj_two', 'password-aj_two'), pt = await tok('taro', 'password-taro'), st = await tok('touhatsu', 'password-touhatsu');
    assert.strictEqual((await callT('POST', '/api/password-resets', { userId: pl }, at2)).s, 403, '他のAJのプレイヤーには出せない');
    assert.strictEqual((await callT('POST', '/api/password-resets', { userId: aj }, pt)).s, 403, 'プレイヤーは上の人に出せない');
    assert.strictEqual((await callT('POST', '/api/password-resets', { userId: cid }, st)).s, 403, '統括は作成者に出せない');
    let r = await callT('POST', '/api/password-resets', { userId: pl }, at); assert.strictEqual(r.s, 200); const old = r.j.code;
    r = await callT('POST', '/api/password-resets', { userId: pl }, at); const code = r.j.code; assert.notStrictEqual(code, old);
    r = await call(app3, 'POST', '/api/password/reset', { code: old, username: 'taro', password: 'new-password-1' }); assert.strictEqual(r.s, 400, '前のコードは使えない');
    r = await call(app3, 'POST', '/api/password/reset', { code, username: 'hana', password: 'new-password-1' }); assert.strictEqual(r.s, 400, '別の人の名前では使えない');
    r = await call(app3, 'POST', '/api/password/reset', { code, username: 'taro', password: 'short' }); assert.strictEqual(r.s, 400);
    r = await call(app3, 'POST', '/api/password/reset', { code: code.toLowerCase(), username: 'TARO', password: 'new-password-1' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
    assert.strictEqual((await callT('GET', '/api/me', null, pt)).s, 401, 'ほかの端末のログインは切れる');
    assert.ok(!(await tok('taro', 'password-taro')), '古いパスワードは使えない'); assert.ok(await tok('taro', 'new-password-1'), '新しいパスワードで入れる');
    r = await call(app3, 'POST', '/api/password/reset', { code, username: 'taro', password: 'new-password-2' }); assert.strictEqual(r.s, 400, '同じコードは2回使えない');
    r = await callT('POST', '/api/password-resets', { userId: sov }, await tok('kaito', 'password-1')); assert.strictEqual(r.s, 200, '作成者は統括に出せる');
    assert.ok(app3.core.L.check().ok);
    ok('パスワードの再設定: 上の立場の人だけがコードを出せ、本人が24時間・1回だけ使える。前のコード・別の人の名前は使えない。変えるとほかの端末のログインは切れる');
    app3.server.close();
  }
  console.log(`最初の設定のテスト: ${n}項目すべて合格`); process.exit(0);
})().catch(e => { console.error('NG', e); process.exit(1); });
