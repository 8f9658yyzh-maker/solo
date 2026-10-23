'use strict';
// 有料プランのテスト。本物の Stripe の代わりに、同じ受け答えをする「にせの Stripe」をこの中で動かします。
const assert = require('node:assert'); const http = require('node:http'); const crypto = require('node:crypto');
const { createApp } = require('./index');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
(async () => {
  // ---- にせの Stripe ----
  const subs = {}; const seen = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      seen.push({ method: req.method, url: req.url, form: Object.fromEntries(new URLSearchParams(b)), auth: req.headers.authorization });
      const j = (o, c) => { res.writeHead(c || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return j({ id: 'cs_test_' + seen.length, url: 'https://checkout.stripe.com/c/pay/cs_test_' + seen.length });
      if (req.method === 'POST' && req.url === '/v1/billing_portal/sessions') return j({ url: 'https://billing.stripe.com/p/session/test_1' });
      const m = req.url.match(/^\/v1\/subscriptions\/(.+)$/);
      if (req.method === 'GET' && m) return subs[m[1]] ? j(subs[m[1]]) : j({ error: { message: 'no such sub' } }, 404);
      j({ error: { message: 'unknown' } }, 404);
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const WH = 'whsec_test_local_only';
  let now = Date.now();
  const app = createApp({ tables: { beatScale: 0, minUnit: 1, entryFee: false }, billing: { STRIPE_SECRET_KEY: 'sk_test_local_only', STRIPE_WEBHOOK_SECRET: WH, PUBLIC_URL: 'https://solo.example', STRIPE_API: 'http://127.0.0.1:' + fake.address().port, clock: () => now } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.core.bootstrap('kaito', 'password-1', '09000000001');
  const call = async (method, path, body, tok, headers) => { const r = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Authorization: tok ? 'Bearer ' + tok : '' }, headers || {}), body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body || {})) }); const j = await r.json().catch(() => ({})); return { s: r.status, j }; };
  const login = async (u, pw) => (await call('POST', '/api/login', { username: u, password: pw, deviceId: 'device-' + u + '-0001' })).j.token;
  const kt = await login('kaito', 'password-1');
  const reg = async (tok, role, name, i) => { const inv = (await call('POST', '/api/invites', { role }, tok)).j.code; const x = await call('POST', '/api/signup', { invite: inv, age18: true, username: name, password: 'password-' + name, phone: '0900000' + (3000 + i), deviceId: 'device-' + name + '-0001' }); assert.strictEqual(x.s, 200, JSON.stringify(x.j)); return x.j.id; };
  const ajId = await reg(kt, 'aj', 'ajone', 1); const at = await login('ajone', 'password-ajone');
  const pid = await reg(at, 'player', 'taro', 2); const pt = await login('taro', 'password-taro');
  const supply0 = (await call('GET', '/api/ledger/check', null, kt)).j;

  // 1. 受け付け停止中(初期値)は申し込めない
  let r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.plan.plan, 'player'); assert.strictEqual(r.j.plan.open, false); assert.strictEqual(r.j.adFree, false);
  r = await call('POST', '/api/plan/checkout', {}, pt); assert.strictEqual(r.s, 400); assert.strictEqual(seen.length, 0);
  ok('最初は申し込みを受け付けない(試験運用中の安全のため)。Stripeにも問い合わせない');
  // 2. 作成者は申し込み不要
  r = await call('GET', '/api/me', null, kt); assert.strictEqual(r.j.plan.plan, null); r = await call('POST', '/api/plan/checkout', {}, kt); assert.strictEqual(r.s, 400);
  ok('作成者・統括・管理責任者にはプランがない');
  // 3. 受け付けの開始は「システム更新中」でしか変えられない
  r = await call('POST', '/api/config', { patch: { billing: 1 } }, kt); assert.strictEqual(r.s, 400);
  await call('POST', '/api/maintenance', { on: true }, kt);
  r = await call('POST', '/api/plan/checkout', {}, pt); assert.strictEqual(r.s, 503);
  r = await call('POST', '/api/config', { patch: { billing: 1, pricePlayer: 50 } }, kt); assert.strictEqual(r.s, 400);
  r = await call('POST', '/api/config', { patch: { billing: 1 } }, kt); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  await call('POST', '/api/maintenance', { on: false }, kt);
  ok('受け付け開始は「システム更新中」の時だけ変えられる。100円未満の金額は断る');
  // 4. 申し込み → Stripe の支払い画面のURL
  r = await call('POST', '/api/plan/checkout', {}, pt); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.ok(r.j.url.startsWith('https://checkout.stripe.com/'));
  let f = seen[seen.length - 1].form;
  assert.strictEqual(f.mode, 'subscription'); assert.strictEqual(f['line_items[0][price_data][unit_amount]'], '680'); assert.strictEqual(f['line_items[0][price_data][currency]'], 'jpy');
  assert.strictEqual(f['subscription_data[metadata][user_id]'], String(pid)); assert.strictEqual(seen[seen.length - 1].auth, 'Bearer sk_test_local_only');
  assert.ok(!JSON.stringify(f).includes('password') && !JSON.stringify(f).includes('0900000'));
  r = await call('POST', '/api/plan/checkout', {}, at); f = seen[seen.length - 1].form; assert.strictEqual(f['line_items[0][price_data][unit_amount]'], '1480');
  ok('申し込むと支払い画面のURLが返る(一般680円・AJ1480円、毎月、日本円)。電話番号やパスワードはStripeに送らない');
  // 5. Stripe からの知らせ: 署名なし・にせの署名・古い署名は断る
  const sign = (raw, t) => { t = t || Math.floor(now / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', WH).update(t + '.' + raw).digest('hex'); };
  const hook = (ev, sig) => { const raw = JSON.stringify(ev); return call('POST', '/api/stripe/webhook', raw, null, { 'Stripe-Signature': sig === undefined ? sign(raw) : sig }); };
  const end = () => Math.floor((now + 30 * 24 * 3600 * 1000) / 1000);
  subs.sub_1 = { id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false, metadata: { user_id: String(pid), plan: 'player' }, items: { data: [{ current_period_end: end(), price: { unit_amount: 680 } }] } };
  const ev1 = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } };
  assert.strictEqual((await hook(ev1, '')).s, 400);
  assert.strictEqual((await hook(ev1, 't=' + Math.floor(now / 1000) + ',v1=' + 'a'.repeat(64))).s, 400);
  { const raw = JSON.stringify(ev1); assert.strictEqual((await call('POST', '/api/stripe/webhook', raw, null, { 'Stripe-Signature': sign(raw, Math.floor(now / 1000) - 600) })).s, 400); }
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.adFree, false);
  ok('にせの「支払い済み」の知らせ(署名なし・違う署名・10分前の使い回し)は断り、プランは有効にならない');
  // 6. 正しい知らせ → 有効になる。同じ知らせが2回来ても1回分
  r = await hook(ev1); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.plan.active, true); assert.strictEqual(r.j.adFree, true); assert.strictEqual(r.j.plan.sub.price, 680);
  r = await hook(ev1); assert.strictEqual(r.j.dup, true);
  r = await call('POST', '/api/plan/checkout', {}, pt); assert.strictEqual(r.s, 400);
  r = await call('GET', '/api/notifications', null, pt); assert.ok(JSON.stringify(r.j).includes('使えるようになりました'));
  ok('正しい知らせで有効になり、広告なしになる。同じ知らせの2回目は無視。入っている人は二重に申し込めない');
  // 7. 解約の予約 → 期限まで使える → 期限が来たら終わる
  subs.sub_1.cancel_at_period_end = true;
  await hook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.plan.active, true); assert.strictEqual(r.j.plan.sub.cancelAtEnd, true);
  r = await call('POST', '/api/plan/portal', {}, pt); assert.ok(r.j.url.startsWith('https://billing.stripe.com/')); assert.strictEqual(seen[seen.length - 1].form.customer, 'cus_1');
  subs.sub_1.status = 'canceled';
  await hook({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.plan.active, false); assert.strictEqual(r.j.adFree, false);
  ok('解約すると期限までは使え、終わると止まる。解約・カード変更はStripeの画面(本人のお客さん番号)へ');
  // 8. 支払い失敗: 3日間はそのまま、それを過ぎたら止まる
  subs.sub_2 = { id: 'sub_2', status: 'past_due', customer: 'cus_2', metadata: { user_id: String(ajId), plan: 'aj' }, items: { data: [{ current_period_end: Math.floor(now / 1000) - 3600, price: { unit_amount: 1480 } }] } };
  await hook({ id: 'evt_4', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_2' } } });
  r = await call('GET', '/api/me', null, at); assert.strictEqual(r.j.plan.active, true);
  now += 4 * 24 * 3600 * 1000;
  r = await call('GET', '/api/me', null, at); assert.strictEqual(r.j.plan.active, false);
  r = await call('GET', '/api/notifications', null, at); assert.ok(JSON.stringify(r.j).includes('支払いができませんでした'));
  ok('支払いに失敗しても3日間は使え、知らせが届く。過ぎると止まる');
  // 9. 持ち主の分からない契約は記録しない / システム更新中でも知らせは受け取る
  subs.sub_x = { id: 'sub_x', status: 'active', metadata: { user_id: '9999', plan: 'player' }, items: { data: [{ current_period_end: end() }] } };
  r = await hook({ id: 'evt_5', type: 'customer.subscription.created', data: { object: { id: 'sub_x' } } }); assert.strictEqual(r.s, 200);
  assert.ok(!app.d.db.prepare("SELECT 1 FROM subscriptions WHERE sub_id='sub_x'").get());
  await call('POST', '/api/maintenance', { on: true }, kt);
  subs.sub_1.status = 'active'; subs.sub_1.cancel_at_period_end = false; subs.sub_1.items.data[0].current_period_end = end();
  r = await hook({ id: 'evt_6', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } }); assert.strictEqual(r.s, 200);
  r = await call('POST', '/api/config', { patch: { pricePlayer: 780 } }, kt); assert.strictEqual(r.s, 200);
  await call('POST', '/api/maintenance', { on: false }, kt);
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.plan.active, true); assert.strictEqual(r.j.plan.sub.price, 680); assert.strictEqual(r.j.plan.price, 780);
  ok('知らない人の契約は記録しない。システム更新中でも知らせは受け取る。値上げしても、入っている人は元の680円のまま');
  // 10. 権限と、チップが一切動かないこと
  assert.strictEqual((await call('GET', '/api/admin/plans', null, pt)).s, 403);
  r = await call('GET', '/api/admin/plans', null, kt); assert.strictEqual(r.j.count, 1); assert.strictEqual(r.j.monthly, 680); assert.strictEqual(r.j.test, true);
  const supply1 = (await call('GET', '/api/ledger/check', null, kt)).j; assert.strictEqual(supply1.ok, true); assert.deepStrictEqual(supply1, supply0);
  assert.strictEqual(app.d.db.prepare("SELECT COUNT(*) c FROM ledger WHERE kind NOT IN ('mint')").get().c, 0);
  ok('加入者の一覧は作成者・統括だけ。プランの手続きで、チップの台帳は1件も動かない');
  // 11. 鍵がない場合
  const app2 = createApp({ tables: { entryFee: false } }); assert.strictEqual(app2.billing.ready(), false);
  ok('鍵がなければ「準備中」の扱いになり、申し込みボタンは出ない');
  console.log(`有料プランのテスト: ${n}項目すべて合格`);
  app.server.close(); fake.close(); process.exit(0);
})().catch(e => { console.error('★失敗:', e); process.exit(1); });
