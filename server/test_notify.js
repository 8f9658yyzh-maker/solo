'use strict';
// 緊急の知らせ(スマホを鳴らす)の試験。本物には送らず、にせの送り先で中身を確かめる
const assert = require('node:assert');
const { Notifier } = require('./notify'); const { createApp } = require('./index');
const D = require('./db'); const { Core } = require('./core');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const fakeFetch = box => async (url, o) => { box.push({ url, body: o.body, headers: o.headers }); return { ok: true, status: 200, text: async () => '' }; };

(async () => {
  // 1. 送り先が未設定なら何もしない
  { const box = []; const nt = new Notifier({}, { fetch: fakeFetch(box) }); assert.strictEqual(nt.on(), false); assert.strictEqual(await nt.send('x', 'y'), false); assert.strictEqual(box.length, 0); ok('送り先が未設定なら、何も送らない'); }
  // 2. ntfy と Pushover へ、緊急は鳴り続ける形で送る。同じ知らせは間をあける
  {
    const box = []; let now = 1e12;
    const nt = new Notifier({ NTFY_TOPIC: 'solo-xyz', NTFY_TOKEN: 'tk_x', PUSHOVER_TOKEN: 'a1', PUSHOVER_USER: 'u1' }, { fetch: fakeFetch(box), now: () => now });
    assert.ok(await nt.send('【緊急】SOLO: テスト', '本文', { key: 'k1' }));
    const ntfy = box.find(x => x.url.startsWith('https://ntfy.sh')), po = box.find(x => x.url.includes('pushover'));
    const j = JSON.parse(ntfy.body); assert.strictEqual(j.topic, 'solo-xyz'); assert.strictEqual(j.priority, 5); assert.strictEqual(j.title, '【緊急】SOLO: テスト'); assert.strictEqual(ntfy.headers.Authorization, 'Bearer tk_x');
    const p = new URLSearchParams(po.body); assert.strictEqual(p.get('priority'), '2'); assert.strictEqual(p.get('retry'), '30'); assert.strictEqual(p.get('sound'), 'siren');
    assert.strictEqual(await nt.send('【緊急】SOLO: テスト', '本文', { key: 'k1' }), false, '30分以内の同じ知らせは送らない');
    now += 31 * 60000; assert.ok(await nt.send('【緊急】SOLO: テスト', '本文', { key: 'k1' }));
    box.length = 0; await nt.send('戻りました', 'ok', { urgent: false }); assert.strictEqual(JSON.parse(box[0].body).priority, 3); assert.strictEqual(new URLSearchParams(box[1].body).get('priority'), '0');
    ok('ntfy(優先度5)と Pushover(押すまで30秒ごとに鳴る)へ送る。同じ知らせは30分あける。「戻りました」はふつうの音');
  }
  // 3. 警報が出たら鳴らし、続いていても繰り返さず、消えたら「戻りました」
  {
    const box = []; const nt = new Notifier({ NTFY_TOPIC: 't' }, { fetch: fakeFetch(box) });
    const app = createApp({ notifier: nt, tables: { feeTickMs: 0 } });
    let t = Date.now();
    assert.deepStrictEqual(await app.alertTick(t), []); assert.strictEqual(box.length, 0);
    app.mon.uncaught = 1; t += 20000; await app.alertTick(t);
    assert.strictEqual(box.length, 1); assert.ok(JSON.parse(box[0].body).title.includes('想定外のエラー'));
    t += 60000; await app.alertTick(t); assert.strictEqual(box.length, 1, '続いている間は6時間鳴らさない');
    app.mon.uncaught = 0; t += 60000; await app.alertTick(t);
    assert.strictEqual(box.length, 2); assert.ok(JSON.parse(box[1].body).title.includes('元に戻りました'));
    app.mon.uncaught = 1; t += 60000; await app.alertTick(t); assert.strictEqual(box.length, 3, '一度消えた警報がまた出たら、すぐ鳴らす');
    app.mon.uncaught = 0; app.server.close();
    ok('警報が出たら1分以内に鳴らす。続いている間は繰り返さず(6時間ごとに念押し)、消えたら「戻りました」。また出たらすぐ鳴らす');
  }
  // 4. 遊んでいる途中で本番が止まった(再起動で卓のチップを戻した)ら鳴らす。何もなければ鳴らさない
  {
    const fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-nt-')), file = path.join(dir, 'solo.db');
    { const d = D.open(file), c = new Core(d); const cid = c.bootstrap('kaito', 'password-1', '09000000001');
      d.db.prepare("INSERT INTO tables_(house_id,name,settings,created_at,status) VALUES(1,'途中の卓','{}',1,'running')").run();
      c.L.transfer('u:' + cid, 's:1:' + cid, 5000, 'buyin', {}); d.db.close(); }
    const box = []; const app = createApp({ dbFile: file, notifier: new Notifier({ NTFY_TOPIC: 't' }, { fetch: fakeFetch(box) }) });
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(box.length, 1); const j = JSON.parse(box[0].body); assert.ok(j.title.includes('遊んでいる途中で本番が止まりました')); assert.ok(j.message.includes('1 卓') && j.message.includes('5000'));
    assert.ok(app.core.L.check().ok); app.d.db.close(); app.server.close();
    const box2 = []; const app2 = createApp({ dbFile: file, notifier: new Notifier({ NTFY_TOPIC: 't' }, { fetch: fakeFetch(box2) }) });
    await new Promise(r => setTimeout(r, 50)); assert.strictEqual(box2.length, 0, 'ふつうの再起動では鳴らさない'); app2.d.db.close(); app2.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    ok('ゲームの途中で本番が止まって再起動したら鳴らす(何卓・何チップを戻したか)。ふつうの再起動では鳴らさない');
  }
  console.log(`緊急の知らせのテスト: ${n}項目すべて合格`); process.exit(0);
})().catch(e => { console.error('NG', e); process.exit(1); });
