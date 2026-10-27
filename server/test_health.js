'use strict';
// 健康診断・IPの読み方・片付けの試験(2026-10-27 エラー対策で追加)
const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createApp } = require('./index');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-health-'));
  const app = createApp({ trustProxy: true, tables: { beatScale: 0, minUnit: 1, feeBp: 0, jackpotBp: 0, entryFee: false, turnMs: 5000, graceMs: 200 } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.core.bootstrap('kaito', 'password-1', '09000000001');
  const get = async (p, h) => { const r = await fetch(base + p, { headers: h || {} }); return { s: r.status, j: await r.json() }; };
  let r = await get('/api/health');
  assert.strictEqual(r.s, 200); assert.strictEqual(r.j.ok, true); assert.strictEqual(r.j.ledger, true); assert.strictEqual(r.j.level, 'ok');
  assert.strictEqual(r.j.diskFreePct, null); assert.strictEqual(r.j.stalledTables, 0);
  app.mon.dataDir = dir; const hd = app.health(Date.now() + 16000); assert.ok(hd.diskFreePct >= 0 && hd.diskFreePct <= 100); app.mon.dataDir = null;   // 空きの割合はこの機械しだいなので、数字が読めることだけ確かめる
  ok('健康診断: 正常なら level=ok。以前と同じ ok・ledger も返す(見張りの設定を変えなくてよい)');
  const t0 = Date.now() + 40000;
  app.d.db.exec("UPDATE accounts SET balance=balance+1 WHERE acct LIKE 'u:%'");   // わざとチップを1枚ずらす
  r = app.health(t0); assert.strictEqual(r.ledger, false); assert.strictEqual(r.level, 'alarm'); assert.ok(r.alarm.includes('ledger'));
  app.d.db.exec("UPDATE accounts SET balance=balance-1 WHERE acct LIKE 'u:%'");
  assert.strictEqual(app.health(t0 + 20000).level, 'ok');
  ok('チップの合計がずれると「警報」、戻すと「正常」');
  const t1 = t0 + 40000;
  for (let i = 0; i < 10; i++) app.mon.errors500.push(t1 - 1000);
  assert.ok(app.health(t1).alarm.includes('errors500')); app.mon.errors500.length = 0;
  app.tables.tableErrors.push(t1 + 19000); assert.ok(app.health(t1 + 20000).warn.includes('tableErrors')); app.tables.tableErrors.length = 0;
  ok('サーバーエラーが10分で10件以上なら警報。卓のエラー停止は1件から注意');
  const fake = { status: 'running', loopOn: true, beat: t1 };
  app.tables.rt.set(99999, fake);
  assert.strictEqual(app.health(t1 + 60000).stalledTables, 0);
  assert.strictEqual(app.health(t1 + 60000 + 5 * 60000).stalledTables, 1);
  fake.status = 'ended'; assert.strictEqual(app.health(t1 + 60000 + 10 * 60000).stalledTables, 0); app.tables.rt.delete(99999);
  ok('動いているのに長く何も起きない卓を「固まった卓」として数える(終わった卓は数えない)');
  const t2 = t1 + 3600000;
  app.mon.lastBackupOk = t2 - 3 * 3600000; assert.ok(app.health(t2).warn.includes('backup'));
  app.mon.lastBackupOk = t2 - 7 * 3600000; assert.ok(app.health(t2 + 20000).alarm.includes('backup'));
  app.mon.lastBackupOk = null; app.mon.lastBackupError = 'x'; assert.ok(app.health(t2 + 40000).alarm.includes('backup'));
  app.mon.lastBackupError = null; app.mon.backupSameDisk = true; assert.ok(app.health(t2 + 60000).warn.includes('backupSameDisk')); app.mon.backupSameDisk = false;
  app.mon.uncaught = 1; assert.ok(app.health(t2 + 80000).alarm.includes('uncaught')); app.mon.uncaught = 0;
  ok('バックアップが2時間なければ注意・6時間なければ警報。同じディスクなら注意。想定外のエラーは警報');
  // IP: 中継(Fly.io)が書いた値だけを信じる。利用者が先頭に書いたにせのIPでは回数制限をすり抜けられない
  let last = 0;
  for (let i = 0; i < 21; i++) { const x = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.7` }, body: JSON.stringify({ username: 'nobody', password: 'wrongwrong', deviceId: 'device-aaaaaaaa' }) }); last = x.status; }
  assert.strictEqual(last, 429);
  last = 0;
  for (let i = 0; i < 21; i++) { const x = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Fly-Client-IP': '198.51.100.9', 'X-Forwarded-For': `10.1.0.${i}` }, body: JSON.stringify({ username: 'nobody', password: 'wrongwrong', deviceId: 'device-aaaaaaaa' }) }); last = x.status; }
  assert.strictEqual(last, 429);
  ok('IPのなりすまし(X-Forwarded-For の先頭を毎回変える)では、ログインの回数制限をすり抜けられない');
  // 片付け
  app.d.db.prepare('INSERT INTO sessions(token,user_id,ip,created_at,expires_at) VALUES(?,?,?,?,?)').run('old-token', 1, '', 0, 1);
  app.hits.set('old-key', [1]);
  const removed = app.tidy();
  assert.ok(removed >= 1); assert.ok(!app.hits.has('old-key')); assert.ok(!app.d.db.prepare("SELECT 1 FROM sessions WHERE token='old-token'").get());
  ok('期限切れのログインと古い回数制限の記録を片付ける');
  app.server.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`健康診断のテスト: ${n}項目すべて合格`); process.exit(0);
})().catch(e => { console.error('NG', e); process.exit(1); });
