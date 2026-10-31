'use strict';
// 有料の特典・広告・チップの申請・規約のテスト。本物の Stripe の代わりに「にせの Stripe」をこの中で動かします。
const assert = require('node:assert'); const http = require('node:http'); const crypto = require('node:crypto');
const { createApp } = require('./index');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // ---- にせの Stripe ----
  const subs = {}; const seen = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      seen.push({ method: req.method, url: req.url, form: Object.fromEntries(new URLSearchParams(b)) });
      const j = (o, c) => { res.writeHead(c || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return j({ id: 'cs_test_' + seen.length, url: 'https://checkout.stripe.com/c/pay/cs_test_' + seen.length });
      const m = req.url.match(/^\/v1\/subscriptions\/(.+)$/);
      if (req.method === 'GET' && m) return subs[m[1]] ? j(subs[m[1]]) : j({ error: { message: 'no such sub' } }, 404);
      j({ error: { message: 'unknown' } }, 404);
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const WH = 'whsec_test_local_only';
  let now = Date.now();
  const env = { STRIPE_SECRET_KEY: 'sk_test_local_only', STRIPE_WEBHOOK_SECRET: WH, PUBLIC_URL: 'https://solo.example', STRIPE_API: 'http://127.0.0.1:' + fake.address().port, clock: () => now,
    ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT: '1234567890', LEGAL_OPERATOR: 'テスト運営<b>', LEGAL_CONTACT: 'help@solo.example' };
  const app = createApp({ tables: { beatScale: 0, minUnit: 1, entryFee: false, feeBp: 0, jackpotBp: 0, turnMs: 3000, graceMs: 150, minStayMs: 0, disconnectGraceMs: 100 }, billing: env });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.core.bootstrap('kaito', 'password-1', '09000000001');
  const call = async (method, path, body, tok, headers) => { const r = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Authorization: tok ? 'Bearer ' + tok : '' }, headers || {}), body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body || {})) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t, h: r.headers }; };
  const login = async (u, pw) => (await call('POST', '/api/login', { username: u, password: pw, deviceId: 'device-' + u + '-0001' })).j.token;
  const kt = await login('kaito', 'password-1');
  const reg = async (tok, role, name, i) => { const inv = (await call('POST', '/api/invites', { role }, tok)).j.code; const x = await call('POST', '/api/signup', { invite: inv, age18: true, username: name, password: 'password-' + name, phone: '0900000' + (3000 + i), deviceId: 'device-' + name + '-0001' }); assert.strictEqual(x.s, 200, JSON.stringify(x.j)); return x.j.id; };
  const manId = await reg(kt, 'manager', 'kanri', 1); const mt = await login('kanri', 'password-kanri');
  const ajId = await reg(mt, 'aj', 'ajone', 2); const at = await login('ajone', 'password-ajone');
  const pid = await reg(at, 'player', 'taro', 3); const pt = await login('taro', 'password-taro');
  const p2 = await reg(at, 'player', 'hana', 4); const ht = await login('hana', 'password-hana');
  const supply0 = app.core.L.check();
  const cfg = async patch => { await call('POST', '/api/maintenance', { on: true }, kt); const r = await call('POST', '/api/config', { patch }, kt); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); await call('POST', '/api/maintenance', { on: false }, kt); };
  const sign = (raw, t) => { t = t || Math.floor(now / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', WH).update(t + '.' + raw).digest('hex'); };
  const hook = ev => { const raw = JSON.stringify(ev); return call('POST', '/api/stripe/webhook', raw, null, { 'Stripe-Signature': sign(raw) }); };

  // 1. 規約: 登録した人は同意済み。版が変わっても卓には座れる(同意し直しは任意)
  let r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.terms.need, false); assert.ok(r.j.terms.ver);
  app.d.db.prepare("UPDATE users SET terms_ver='old' WHERE id=?").run(pid);
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.terms.need, true);
  r = await call('POST', '/api/terms/agree', { ver: 'x' }, pt); assert.strictEqual(r.s, 400);
  r = await call('POST', '/api/terms/agree', { ver: r.j.ver || (await call('GET', '/api/me', null, pt)).j.terms.ver }, pt); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.terms.need, false);
  r = await call('GET', '/legal/terms', null); assert.strictEqual(r.s, 200); assert.ok(r.t.includes('テスト運営&lt;b&gt;'), '運営者名は文字として差し込む(タグにしない)');
  r = await call('GET', '/legal/tokushoho', null); assert.strictEqual(r.s, 200); assert.ok(r.t.includes('【未記入】'), '販売者の情報が無いときは、目に見える形で未記入と出す'); assert.ok(r.t.includes('680円'));
  for (const pg of ['privacy', 'external', 'sponsor']) { r = await call('GET', '/legal/' + pg, null); assert.strictEqual(r.s, 200, pg); }
  r = await call('GET', '/legal/../index', null); assert.notStrictEqual(r.s, 200);
  ok('利用規約: 登録時に同意を記録。版が変わっても遊ぶのは止めない(同意し直しは任意)。規約・プライバシー・外部送信・特商法・広告主募集のページを出し、空欄は【未記入】');

  // 2. 戦績: 本物の卓で2人がゲームをすると、1人1ゲームごとに記録され、本人だけが見られる
  const give = (to, amt) => call('POST', '/api/give', { to, amount: amt }, at);
  await call('POST', '/api/give', { to: manId, amount: 1000000 }, kt); await call('POST', '/api/give', { to: ajId, amount: 500000 }, mt);
  await give(pid, 50000); await give(p2, 50000);
  const aj = app.core.user(ajId), tb = app.tables.create(aj, '戦績卓', { seats: 4, ante: 10, minBet: 10, limit: 100, startMode: 'free' }); const rt = app.tables.get(tb.id);
  const bots = [];
  for (const [uid, tok] of [[pid, pt], [p2, ht]]) {
    r = await call('POST', '/api/tables/' + tb.id + '/join', { buyIn: 5000 }, tok); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
    const u = app.core.user(uid), b = { res: { write: s => { if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6)); if (v.req && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; if (!rt.pending || rt.pending.req.seat !== v.req.seat) return; const q = v.req; try { rt.act(u, q.type === 'carryJoin' ? { act: q.short ? 'skip' : 'join' } : q.type === 'oya' ? { act: 'bet', amount: q.cap } : q.type === 'biki' ? { act: 'follow', up: 0 } : { act: 'follow' }); } catch (e) {} }); } } } };
    rt.subscribe(u, b.res); bots.push([u, b]);
  }
  for (let i = 0; i < 200 && app.d.db.prepare('SELECT COUNT(*) AS c FROM player_games').get().c < 4; i++) await sleep(25);
  const rows = app.d.db.prepare('SELECT * FROM player_games ORDER BY id').all();
  assert.ok(rows.length >= 4, '2ゲーム分の記録 ' + rows.length);
  assert.strictEqual(rows.filter(x => x.game_no === rows[0].game_no).reduce((a, x) => a + x.delta, 0) <= 0, true, '1ゲームの増減の合計は0以下(手数料なしなら0)');
  rt.stop(); for (const [u, b] of bots) rt.unsubscribe(u, b.res);
  for (let i = 0; i < 200 && !['ended', 'stopped'].includes(rt.status); i++) await sleep(25);
  let st = (await call('GET', '/api/stats?days=7', null, pt)).j;
  assert.strictEqual(st.full, false); assert.ok(st.games >= 2); assert.strictEqual(st.hands, undefined, '無料の人には手役の内訳を出さない');
  r = await call('GET', '/api/stats?days=0', null, pt); assert.strictEqual(r.j.days, 7, '無料の人は全期間を選んでも7日');
  r = await call('GET', '/api/stats?days=3', null, kt); assert.strictEqual(r.s, 400);
  const mine = app.d.db.prepare('SELECT COALESCE(SUM(delta),0) AS s, COUNT(*) AS c FROM player_games WHERE user_id=?').get(pid);
  assert.strictEqual(st.net, mine.s); assert.strictEqual(st.games, mine.c);
  // 以前のゲームの作り直し(backfill)でも同じ数になる
  const cnt = () => app.d.db.prepare('SELECT COUNT(*) AS c FROM player_games').get().c, before = cnt();   // 卓を止めるまでにもゲームが進むので、作り直す直前の数と比べる
  app.d.db.exec('DELETE FROM player_games'); app.d.setMeta('pg_backfill', '0'); app.stats.backfill();
  assert.strictEqual(cnt(), before);
  ok('戦績: 卓のゲームごとに自分の記録が残る(勝ち負けの合計が合う)。無料は7日・基本の数字だけ。以前のゲームも作り直せる');

  // 3. テーマ: 無料は標準だけ。プランなしで選ぶと断る
  r = await call('GET', '/api/me', null, pt); assert.deepStrictEqual(r.j.perks.themes, ['classic']); assert.strictEqual(r.j.perks.theme, 'classic');
  r = await call('POST', '/api/prefs', { theme: 'kogane' }, pt); assert.strictEqual(r.s, 403);
  r = await call('POST', '/api/prefs', { theme: 'nai' }, pt); assert.strictEqual(r.s, 404);
  r = await call('GET', '/api/me', null, kt); assert.strictEqual(r.j.perks.themes.length, 5, '作成者は全部使える');
  ok('テーマ: 無料は標準だけ。持っていないテーマは選べない。作成者・統括・管理責任者は全部');

  // 4. 単品の購入: 受け付け停止中は不可 → 受け付けると支払い画面へ。知らせが来て初めて使える。同じ知らせ2回でも1つ。返金で使えなくなる
  r = await call('POST', '/api/shop/buy', { item: 'theme_kogane' }, pt); assert.strictEqual(r.s, 400); assert.strictEqual(seen.length, 0);
  await cfg({ billing: 1, priceTheme: 320 });
  r = await call('POST', '/api/shop/buy', { item: 'theme_nai' }, pt); assert.strictEqual(r.s, 404);
  r = await call('POST', '/api/shop/buy', { item: 'theme_kogane', price: 1 }, pt); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  let f = seen[seen.length - 1].form;
  assert.strictEqual(f.mode, 'payment'); assert.strictEqual(f['line_items[0][price_data][unit_amount]'], '320', '値段はサーバーの設定。画面から送った値は使わない'); assert.strictEqual(f['metadata[item]'], 'theme_kogane'); assert.strictEqual(f['metadata[user_id]'], String(pid));
  r = await call('POST', '/api/shop/buy', { item: 'theme_kogane' }, kt); assert.strictEqual(r.s, 400, '作成者は買う必要がない');
  const paidEv = id => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test_x', mode: 'payment', payment_status: 'paid', amount_total: 320, payment_intent: 'pi_1', metadata: { user_id: String(pid), item: 'theme_kogane' } } } });
  r = await hook({ id: 'evt_u1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_u', mode: 'payment', payment_status: 'unpaid', metadata: { user_id: String(pid), item: 'theme_kogane' } } } }); assert.strictEqual(r.s, 200);
  r = await call('GET', '/api/me', null, pt); assert.ok(!r.j.perks.themes.includes('kogane'), '未払いでは付かない');
  const raw = JSON.stringify(paidEv('evt_p1')); r = await call('POST', '/api/stripe/webhook', raw, null, { 'Stripe-Signature': 't=1,v1=bad' }); assert.strictEqual(r.s, 400);
  r = await hook(paidEv('evt_p1')); assert.strictEqual(r.s, 200); r = await hook(paidEv('evt_p2'));
  assert.strictEqual(app.d.db.prepare("SELECT COUNT(*) AS c FROM user_items WHERE user_id=?").get(pid).c, 1, '同じ支払いは1回だけ');
  r = await call('GET', '/api/me', null, pt); assert.ok(r.j.perks.themes.includes('kogane'));
  r = await call('POST', '/api/prefs', { theme: 'kogane' }, pt); assert.strictEqual(r.s, 200); r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.perks.theme, 'kogane');
  r = await call('POST', '/api/shop/buy', { item: 'theme_kogane' }, pt); assert.strictEqual(r.s, 400, '持っている物は二重に買えない');
  r = await call('GET', '/api/admin/sales', null, kt); assert.strictEqual(r.j.total, 320); r = await call('GET', '/api/admin/sales', null, pt); assert.strictEqual(r.s, 403);
  r = await hook({ id: 'evt_r0', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount_refunded: 100 } } });
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.perks.theme, 'kogane', '一部の返金では止めない');
  r = await hook({ id: 'evt_r1', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount_refunded: 320 } } });
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.perks.theme, 'classic', '全額返金で使えなくなり、標準に戻る');
  assert.deepStrictEqual(app.core.L.check(), Object.assign({}, supply0, app.core.L.check()), 'チップの台帳は合ったまま');
  assert.strictEqual(app.core.L.check().supply, supply0.supply);
  ok('単品: 値段と商品はサーバーで決める。支払い済みの知らせ(署名つき)で付き、2回来ても1つ。全額返金で使えなくなる。チップは動かない');

  // 5. 有料プラン: 全テーマ・詳しい戦績・広告なし。更新ごとの手札確認チケットは設定で(既定0枚)
  const end = () => Math.floor((now + 30 * 24 * 3600 * 1000) / 1000);
  subs.sub_p = { id: 'sub_p', status: 'active', customer: 'cus_p', current_period_end: end(), cancel_at_period_end: false, metadata: { user_id: String(p2), plan: 'player' }, items: { data: [{ price: { unit_amount: 680 } }] } };
  r = await hook({ id: 'evt_s1', type: 'customer.subscription.created', data: { object: { id: 'sub_p' } } }); assert.strictEqual(r.s, 200);
  r = await call('GET', '/api/me', null, ht); assert.strictEqual(r.j.perks.themes.length, 5); assert.strictEqual(r.j.ad.on, false); assert.strictEqual(app.core.peekBalance(p2), 0, '既定ではチケットを付けない');
  st = (await call('GET', '/api/stats?days=0', null, ht)).j; assert.strictEqual(st.full, true); assert.strictEqual(st.days, 0); assert.ok(st.hands && st.daily && st.tables && st.odds);
  await cfg({ planPeek: 5 });
  subs.sub_p.current_period_end = end() + 30 * 86400;   // 次の月
  await hook({ id: 'evt_s2', type: 'customer.subscription.updated', data: { object: { id: 'sub_p' } } });
  await hook({ id: 'evt_s3', type: 'customer.subscription.updated', data: { object: { id: 'sub_p' } } });
  assert.strictEqual(app.core.peekBalance(p2), 5, '同じ月は1回だけ');
  await cfg({ planPeek: 0 });
  ok('有料プラン: 全テーマ・詳しい戦績(全期間・手役の内訳・日ごと・卓ごと)・広告なし。手札確認チケットは設定した時だけ・月1回');

  // 6. 広告: スポンサーの登録は作成者・統括だけ。危ないリンク・大きすぎる画像は断る。選ばれると表示1回、押すとクリック1回
  r = await call('POST', '/api/admin/sponsors', { name: 'x', text: 'y' }, at); assert.strictEqual(r.s, 403);
  r = await call('POST', '/api/admin/sponsors', { name: '石垣の店', text: '島そば', url: 'javascript:alert(1)' }, kt); assert.strictEqual(r.s, 400);
  r = await call('POST', '/api/admin/sponsors', { name: '石垣の店', text: '島そば', image: 'data:image/svg+xml;base64,AAAA' }, kt); assert.strictEqual(r.s, 400, 'SVGは中に命令を書けるので断る');
  r = await call('POST', '/api/admin/sponsors', { name: '石垣の店', text: '島そば 大盛り無料', url: 'https://example.com/soba', image: 'data:image/png;base64,iVBORw0KGgo=', slot: 'banner' }, kt); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); const sid = r.j.id;
  r = await call('GET', '/api/ads/pick?slot=banner', null, pt); assert.strictEqual(r.j.ad, null, '広告が「出さない」の設定のうちは出ない');
  await cfg({ ads: 1 });
  r = await call('GET', '/api/ads/pick?slot=banner', null, pt); assert.strictEqual(r.j.ad.id, sid); assert.strictEqual(r.j.ad.url, 'https://example.com/soba');
  r = await call('GET', '/api/ads/pick?slot=full', null, pt); assert.strictEqual(r.j.ad, null, 'バナー専用は全画面に出ない');
  r = await call('GET', '/api/ads/pick?slot=banner', null, ht); assert.strictEqual(r.j.ad, null, '有料プランの人には出ない(サーバーでも判定)');
  r = await call('GET', '/api/ads/pick?slot=banner', null, kt); assert.strictEqual(r.j.ad, null, '作成者には出ない');
  r = await call('POST', '/api/ads/click', { id: sid }, pt); assert.strictEqual(r.j.url, 'https://example.com/soba');
  r = await call('GET', '/api/admin/sponsors', null, kt); const s0 = r.j.find(x => x.id === sid); assert.strictEqual(s0.imp30, 1); assert.strictEqual(s0.clicks30, 1); assert.strictEqual(s0.image, true);
  r = await call('PATCH', '/api/admin/sponsors/' + sid, { active: 0 }, kt); assert.strictEqual(r.s, 200);
  r = await call('GET', '/api/ads/pick?slot=banner', null, pt); assert.strictEqual(r.j.ad, null, '止めた広告は出ない');
  r = await call('PATCH', '/api/admin/sponsors/' + sid, { active: 1, end_at: now - 1000, start_at: now - 5000 }, kt); r = await call('GET', '/api/ads/pick?slot=banner', null, pt); assert.strictEqual(r.j.ad, null, '期間が終わった広告は出ない');
  ok('広告(地元スポンサー): 登録は作成者・統括だけ。https以外のリンク・SVG画像は断る。期間と停止を守る。表示とクリックを日ごとに数える。有料の人・作成者には出ない');

  // 7. 広告会社: 設定で使うにすると、ads.txt と安全の決まり(CSP)に Google が入る。使わないうちは入らない
  r = await call('GET', '/ads.txt', null); assert.strictEqual(r.s, 200); assert.ok(r.t.includes('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0'));
  r = await call('GET', '/', null); assert.ok(!r.h.get('content-security-policy').includes('googlesyndication'));
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.ad.net, null);
  await cfg({ adNet: 1 });
  r = await call('GET', '/', null); assert.ok(r.h.get('content-security-policy').includes('pagead2.googlesyndication.com'));
  r = await call('GET', '/api/me', null, pt); assert.strictEqual(r.j.ad.net.client, 'ca-pub-1234567890123456'); assert.strictEqual(r.j.ad.gapMin, 10);
  r = await call('GET', '/api/me', null, ht); assert.strictEqual(r.j.ad.net, null);
  ok('広告会社(AdSense): 番号と設定がそろった時だけ、画面の読み込み先と ads.txt に入る。有料の人には渡さない');

  // 8. チップの申請: AJ→管理責任者。プレイヤーは申請できない。承認でポケットから配られる。足りない時は配らず待ちのまま
  r = await call('POST', '/api/chip-requests', { amount: 1000 }, pt); assert.strictEqual(r.s, 403);
  r = await call('POST', '/api/chip-requests', { amount: 0 }, at); assert.strictEqual(r.s, 400);
  r = await call('POST', '/api/chip-requests', { amount: 20000, note: '卓を増やすため' }, at); assert.strictEqual(r.s, 200); const q1 = r.j.id;
  r = await call('GET', '/api/chip-requests', null, mt); assert.strictEqual(r.j.inbox.length, 1); assert.strictEqual(r.j.inbox[0].from_name, 'ajone');
  r = await call('POST', '/api/chip-requests/' + q1 + '/approve', {}, pt); assert.strictEqual(r.s, 403);
  const ajBefore = app.core.pocket(ajId), manBefore = app.core.pocket(manId);
  r = await call('POST', '/api/chip-requests/' + q1 + '/approve', {}, mt); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  assert.strictEqual(app.core.pocket(ajId), ajBefore + 20000); assert.strictEqual(app.core.pocket(manId), manBefore - 20000);
  r = await call('POST', '/api/chip-requests/' + q1 + '/approve', {}, mt); assert.strictEqual(r.s, 400, '2回は配らない');
  r = await call('POST', '/api/give', { to: pid, amount: 10 ** 12 }, at); assert.strictEqual(r.s, 400, '足りないときは「足りません」(サーバーの故障の500にしない)');
  r = await call('POST', '/api/pull', { from: pid, amount: 10 ** 12 }, at); assert.strictEqual(r.s, 400);
  assert.strictEqual(app.health().errors500_10m, 0, 'サーバーエラーとして数えられていない');
  r = await call('POST', '/api/chip-requests', { amount: 99999999 }, at); const q2 = r.j.id;
  r = await call('POST', '/api/chip-requests/' + q2 + '/approve', {}, mt); assert.strictEqual(r.s, 400);
  assert.strictEqual(app.d.db.prepare('SELECT status FROM chip_requests WHERE id=?').get(q2).status, 'open');
  r = await call('POST', '/api/chip-requests/' + q2 + '/decline', { reply: '多すぎます' }, mt); assert.strictEqual(r.s, 200);
  r = await call('POST', '/api/chip-requests', { amount: 5000 }, mt); const q3 = r.j.id;
  r = await call('GET', '/api/chip-requests', null, kt); assert.ok(r.j.inbox.some(x => x.id === q3), '管理責任者の申請は作成者・統括に届く');
  r = await call('POST', '/api/chip-requests/' + q3 + '/cancel', {}, mt); assert.strictEqual(r.s, 200);
  assert.strictEqual(app.core.L.check().ok, true);
  ok('チップの申請: AJ・管理責任者だけ。宛先の人だけが承認でき、承認で台帳どおりに配られる。足りない時は配らない。取り消しもできる');

  // 9. 写真: 変更の要望に3枚まで付けられ、あとで見られる。大きめの写真(約200KB)も届く。SVG・4枚目は断る
  const big = 'data:image/jpeg;base64,' + crypto.randomBytes(200000).toString('base64');
  r = await call('POST', '/api/requests', { body: '卓の画面をこうしたい', images: [big, big, big] }, kt); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); const rq = r.j.id;
  r = await call('POST', '/api/requests', { body: 'x', images: [big, big, big, big] }, kt); assert.strictEqual(r.s, 400);
  r = await call('POST', '/api/requests', { body: 'x', images: ['data:image/svg+xml;base64,AAAA'] }, kt); assert.strictEqual(r.s, 400);
  r = await call('POST', '/api/requests', { images: [big] }, kt); assert.strictEqual(r.s, 200, '写真だけでも控えられる');
  r = await call('POST', '/api/requests', { body: '' }, kt); assert.strictEqual(r.s, 400);
  r = await call('GET', '/api/requests', null, kt); assert.strictEqual(r.j.find(x => x.id === rq).nimg, 3); assert.ok(!('images' in r.j[0]), '一覧には写真そのものは入れない(軽くするため)');
  r = await call('GET', '/api/requests/' + rq + '/images', null, kt); assert.strictEqual(r.j.images.length, 3); assert.strictEqual(r.j.images[0], big);
  r = await call('GET', '/api/requests/' + rq + '/images', null, pt); assert.strictEqual(r.s, 403);
  r = await call('POST', '/api/give', { to: pid, amount: 1, note: 'x'.repeat(200000) }, at); assert.strictEqual(r.s, 413, 'ほかの所は今までどおり 100KB まで');
  r = await call('POST', '/api/admin/sponsors', { name: '大きい画像の店', text: '本物の大きさの画像', image: big }, kt); assert.strictEqual(r.s, 200, 'スポンサーの画像も実際の大きさで届く');
  ok('写真: 変更の要望に3枚まで(写真だけでも可)、作成者・統括だけが見られる。SVG・4枚目は断る。実際の大きさの写真もスポンサーの画像も届く');

  console.log(`特典・広告・申請・規約のテスト: ${n}項目すべて合格`);
  app.server.close(); fake.close(); process.exit(0);
})().catch(e => { console.error('NG', e); process.exit(1); });
