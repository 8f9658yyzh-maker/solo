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
  console.log(`最初の設定のテスト: ${n}項目すべて合格`); process.exit(0);
})().catch(e => { console.error('NG', e); process.exit(1); });
