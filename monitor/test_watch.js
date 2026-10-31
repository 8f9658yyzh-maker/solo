'use strict';
// 見張り役のテスト。にせのサーバーと、にせの LINE と、にせの KV で動かす(本物には送らない)
const assert = require('node:assert');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
(async () => {
  const W = await import('./worker.mjs');
  const store = {}, kv = { get: async k => store[k] || null, put: async (k, v) => { store[k] = v; kv.writes++; }, writes: 0 };
  const env = { HEALTH_URL: 'https://solo.example/api/health', LINE_TOKEN: 'tok', LINE_TO: 'U123', KV: kv };
  let health = { status: 200, body: { ok: true, level: 'ok', alarm: [] } }, sent = [];
  const fake = async (url, o) => {
    if (url.startsWith('https://api.line.me/')) { sent.push({ url, body: JSON.parse(o.body), auth: o.headers.Authorization }); return { ok: true, text: async () => '' }; }
    if (health === 'down') throw new TypeError('fetch failed');
    return { ok: health.status < 400, status: health.status, json: async () => health.body };
  };
  let t = Date.now();
  let r = await W.check(env, t, fake); assert.strictEqual(r.ok, true); assert.strictEqual(sent.length, 0); assert.strictEqual(kv.writes, 0);
  ok('ふだん(正常)は何も送らず、記録も書かない(無料の書き込み回数を使わない)');
  health = 'down';
  r = await W.check(env, t += 300000, fake); assert.strictEqual(sent.length, 0, '1回目では鳴らさない');
  r = await W.check(env, t += 300000, fake); assert.strictEqual(sent.length, 1); assert.strictEqual(r.down, true);
  assert.ok(sent[0].url.endsWith('/push')); assert.strictEqual(sent[0].body.to, 'U123'); assert.ok(sent[0].body.messages[0].text.includes('つながりません')); assert.strictEqual(sent[0].auth, 'Bearer tok');
  for (let i = 0; i < 10; i++) await W.check(env, t += 300000, fake);
  assert.strictEqual(sent.length, 1, '止まっている間は何度も送らない');
  await W.check(env, t += 6 * 3600000, fake); assert.strictEqual(sent.length, 2); assert.ok(sent[1].body.messages[0].text.includes('まだ続いています'));
  ok('2回続けて問題があったら1回だけ知らせ、続いていれば6時間ごとに念押し');
  health = { status: 200, body: { ok: true, level: 'ok' } };
  await W.check(env, t += 300000, fake); assert.strictEqual(sent.length, 3); assert.ok(sent[2].body.messages[0].text.includes('元に戻りました'));
  await W.check(env, t += 300000, fake); assert.strictEqual(sent.length, 3);
  ok('直ったら「戻りました」を1回だけ');
  health = { status: 200, body: { ok: true, level: 'alarm', alarm: ['ledger', 'backup'] } };
  await W.check(env, t += 300000, fake); await W.check(env, t += 300000, fake);
  assert.strictEqual(sent.length, 4); assert.ok(sent[3].body.messages[0].text.includes('チップの合計が合いません・バックアップが取れていません'));
  health = { status: 200, body: { ok: true, level: 'warn', warn: ['backup'] } };
  await W.check(env, t += 300000, fake); assert.strictEqual(sent.length, 5, '注意(warn)は戻った扱い。鳴らすのは警報(alarm)と停止だけ');
  ok('サーバーは動いていても「警報」(チップの合計のずれ等)なら日本語の理由つきで知らせる');
  const env2 = Object.assign({}, env, { LINE_TO: '' }); health = { status: 503, body: {} };
  await W.check(env2, t += 300000, fake); await W.check(env2, t += 300000, fake);
  assert.ok(sent[sent.length - 1].url.endsWith('/broadcast')); assert.strictEqual(sent[sent.length - 1].body.to, undefined);
  ok('知らせる相手を決めていなければ、友だち全員(=自分だけ)に送る');
  console.log(`見張り役のテスト: ${n}項目すべて合格`);
})().catch(e => { console.error('NG', e); process.exit(1); });
