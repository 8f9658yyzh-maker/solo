'use strict';
// 有料プラン(毎月の自動払い)。Stripe(決済の会社)とのやりとりは、このファイルだけで行います。
// - 申し込み: Stripe の支払い画面(チェックアウト)へ案内する。カード番号はこのアプリを通らない。
// - 結果の受け取り: Stripe からの知らせ(Webhook)を、署名を確かめてから記録する。
// - プランでできること: チップは一切増えない(お金でチップを買える形にしないため)。広告なし・詳しい戦績・卓のテーマなど、遊びの外側だけ。
// - 単品(買い切り): 卓のテーマを1つずつ。商品と値段はサーバー側だけで決め、画面からは商品の名前しか受け取らない。
const crypto = require('node:crypto');
const { Err, need } = require('./core');

const GRACE_MS = 3 * 24 * 3600 * 1000;   // 支払いが一時的に失敗しても、3日は使えるままにする(Stripe が自動で払い直すため)
const PLAN_JA = { player: '一般プラン', aj: 'AJプラン' };

class Billing {
  constructor(D, core, env) {
    env = env || {};
    this.D = D; this.db = D.db; this.core = core;
    this.key = env.STRIPE_SECRET_KEY || '';
    this.whsec = env.STRIPE_WEBHOOK_SECRET || '';
    this.base = (env.STRIPE_API || 'https://api.stripe.com').replace(/\/$/, '');
    this.publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');
    this.fetch = env.fetch || ((...a) => fetch(...a));
    this.now = env.clock || (() => Date.now());
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions(user_id INTEGER PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL, customer TEXT, sub_id TEXT UNIQUE,
        price INTEGER, period_end INTEGER NOT NULL DEFAULT 0, cancel_at_end INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY, type TEXT NOT NULL, ts INTEGER NOT NULL);`);
  }
  // 鍵が3つそろっているか(そろっていなければ、申し込みボタンを出さない)
  ready() { return !!(this.key && this.whsec && this.publicUrl); }
  testMode() { return /^(sk|rk)_test_/.test(this.key); }
  planOf(u) { return u && (u.role === 'aj' ? 'aj' : u.role === 'player' ? 'player' : null); }   // 作成者・統括・管理責任者はプラン不要
  price(plan) { return plan === 'aj' ? this.core.cfg.PRICE_AJ : this.core.cfg.PRICE_PLAYER; }
  row(uid) { return this.db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(uid); }
  // 今、有料プランの機能を使えるか
  active(uid) {
    const r = this.row(uid); if (!r) return false;
    if (!['active', 'trialing', 'past_due'].includes(r.status)) return false;
    return r.period_end + (r.status === 'past_due' ? GRACE_MS : 0) > this.now();
  }
  status(u) {
    const plan = this.planOf(u), r = this.row(u.id);
    return {
      plan, planName: PLAN_JA[plan] || null, price: plan ? this.price(plan) : null,
      open: !!(plan && this.core.cfg.BILLING && this.ready()),   // 申し込みを受け付けているか
      test: this.testMode(), active: this.active(u.id),
      sub: r ? { plan: r.plan, status: r.status, periodEnd: r.period_end, cancelAtEnd: !!r.cancel_at_end, price: r.price, portal: !!r.customer } : null
    };
  }

  // ---------- Stripe への問い合わせ ----------
  async stripe(method, path, form) {
    need(this.key, '決済の設定がまだです', 503);
    const body = form ? new URLSearchParams(form).toString() : undefined;
    let r;
    try { r = await this.fetch(this.base + path, { method, headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }, body }); }
    catch (e) { throw new Err('決済の会社につながりません。しばらくしてからやり直してください', 502); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('[stripe]', method, path, r.status, j.error && j.error.message); throw new Err('決済の手続きでエラーが起きました(' + r.status + ')', 502); }
    return j;
  }
  // 申し込み: Stripe の支払い画面のURLを返す
  async checkout(u) {
    const plan = this.planOf(u);
    need(plan, 'あなたの立場では、有料プランは必要ありません', 400);
    need(this.ready(), '決済の設定がまだです', 503);
    need(this.core.cfg.BILLING, 'いまは有料プランの申し込みを受け付けていません', 400);
    need(!this.active(u.id), 'すでに有料プランに入っています');
    const r = this.row(u.id), price = this.price(plan);
    const f = {
      mode: 'subscription', locale: 'ja', client_reference_id: String(u.id),
      'metadata[user_id]': String(u.id), 'metadata[plan]': plan,
      'subscription_data[metadata][user_id]': String(u.id), 'subscription_data[metadata][plan]': plan,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'jpy',
      'line_items[0][price_data][unit_amount]': String(price),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'SOLO ' + PLAN_JA[plan],
      success_url: this.publicUrl + '/?plan=ok#/wallet',
      cancel_url: this.publicUrl + '/?plan=cancel#/wallet'
    };
    if (r && r.customer) f.customer = r.customer;   // 2回目以降は同じお客さん番号を使う(二重登録を防ぐ)
    const s = await this.stripe('POST', '/v1/checkout/sessions', f);
    this.D.audit(u.id, 'plan_checkout', u.id, { plan, price, session: s.id });
    need(s.url, '支払い画面のURLを受け取れませんでした', 502);
    return { url: s.url };
  }
  // 単品の購入(買い切り): Stripe の支払い画面のURLを返す。付くのは、Stripe から「支払い済み」の知らせが届いたとき
  async buy(u, itemId) {
    need(this.perks, '準備中です', 503);
    const item = this.perks.item(String(itemId || ''));
    need(item, 'その商品はありません', 404);
    need(this.planOf(u), 'あなたの立場では、購入しなくても使えます', 400);
    need(this.ready(), '決済の設定がまだです', 503);
    need(this.core.cfg.BILLING, 'いまは購入を受け付けていません', 400);
    need(!this.perks.owns(u.id, itemId), 'すでに持っています');
    const price = this.perks.price(), r = this.row(u.id);
    const f = {
      mode: 'payment', locale: 'ja', client_reference_id: String(u.id),
      'metadata[user_id]': String(u.id), 'metadata[item]': itemId, 'metadata[price]': String(price),
      'payment_intent_data[metadata][user_id]': String(u.id), 'payment_intent_data[metadata][item]': itemId,
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'jpy',
      'line_items[0][price_data][unit_amount]': String(price),
      'line_items[0][price_data][product_data][name]': 'SOLO ' + item.name,
      success_url: this.publicUrl + '/?buy=ok#/wallet',
      cancel_url: this.publicUrl + '/?buy=cancel#/wallet'
    };
    if (r && r.customer) f.customer = r.customer;
    const s = await this.stripe('POST', '/v1/checkout/sessions', f);
    this.D.audit(u.id, 'item_checkout', u.id, { item: itemId, price, session: s.id });
    need(s.url, '支払い画面のURLを受け取れませんでした', 502);
    return { url: s.url };
  }
  // 単品の支払いが終わった知らせ。金額と商品は、こちらが申し込みのときに決めた値(metadata)を使う
  paid(o) {
    if (!this.perks || o.mode !== 'payment' || o.payment_status !== 'paid') return;
    const uid = Number(o.metadata && o.metadata.user_id), item = o.metadata && o.metadata.item;
    if (!uid || !this.core.user(uid) || !this.perks.item(item)) { console.error('[stripe] 持ち主か商品の分からない支払い', o.id); return; }
    const price = Number(o.amount_total != null ? o.amount_total : (o.metadata && o.metadata.price)) || null;
    if (this.perks.grant(uid, item, 'stripe', o.id, o.payment_intent || null, price)) this.core.notify(uid, 'plan', { msg: this.perks.item(item).name + 'が使えるようになりました' });
  }
  // 解約・カード変更: Stripe の「お客さま用の管理画面」のURLを返す
  async portal(u) {
    const r = this.row(u.id); need(r && r.customer, 'まだ有料プランの記録がありません');
    const s = await this.stripe('POST', '/v1/billing_portal/sessions', { customer: r.customer, return_url: this.publicUrl + '/#/wallet' });
    return { url: s.url };
  }

  // ---------- Stripe からの知らせ(Webhook) ----------
  // 署名を確かめる: 合い言葉(whsec)を知らない人が、にせの「支払い済み」を送れないようにする
  verify(raw, header) {
    need(this.whsec, '決済の設定がまだです', 503);
    const parts = String(header || '').split(',').map(s => s.trim().split('='));
    const t = Number((parts.find(p => p[0] === 't') || [])[1]);
    const sigs = parts.filter(p => p[0] === 'v1').map(p => p[1]);
    need(t && sigs.length, '署名がありません', 400);
    need(Math.abs(this.now() / 1000 - t) <= 300, '署名の時刻が古すぎます', 400);   // 盗んだ知らせの使い回しを防ぐ
    const want = Buffer.from(crypto.createHmac('sha256', this.whsec).update(t + '.' + raw).digest('hex'));
    need(sigs.some(s => { const b = Buffer.from(String(s)); return b.length === want.length && crypto.timingSafeEqual(b, want); }), '署名が正しくありません', 400);
    return JSON.parse(raw);
  }
  async webhook(raw, header) {
    const ev = this.verify(raw, header);
    need(ev && ev.id && ev.type, '内容が正しくありません', 400);
    if (this.db.prepare('SELECT 1 FROM stripe_events WHERE id=?').get(ev.id)) return { dup: true };   // 同じ知らせが2回来ても1回分だけ
    const o = (ev.data && ev.data.object) || {};
    let subId = null;
    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') subId = o.subscription;
    else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) subId = o.id;
    else if (ev.type === 'invoice.payment_failed') subId = o.subscription;
    // 知らせの順番は入れ替わることがあるので、毎回 Stripe に最新の状態を聞き直してから記録する
    if (subId) await this.sync(subId, ev.type);
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') this.paid(o);
    if (ev.type === 'charge.refunded' && o.refunded && this.perks) this.perks.revokeByPayment(o.payment_intent);   // 全額の返金だけ。一部返金では止めない
    this.db.prepare('INSERT OR IGNORE INTO stripe_events(id,type,ts) VALUES(?,?,?)').run(ev.id, ev.type, this.now());
    return { ok: true };
  }
  async sync(subId, why) {
    const s = await this.stripe('GET', '/v1/subscriptions/' + encodeURIComponent(subId));
    const uid = Number(s.metadata && s.metadata.user_id), plan = s.metadata && s.metadata.plan;
    if (!uid || !this.core.user(uid) || !PLAN_JA[plan]) { console.error('[stripe] 持ち主の分からない契約', subId); return; }
    const item = s.items && s.items.data && s.items.data[0] || {};
    const end = (s.current_period_end || item.current_period_end || 0) * 1000;   // 新しい版では明細の側に入っている
    const price = (item.price && item.price.unit_amount) || null;
    const before = this.row(uid), wasActive = this.active(uid);
    this.db.prepare(`INSERT INTO subscriptions(user_id,plan,status,customer,sub_id,price,period_end,cancel_at_end,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,customer=COALESCE(excluded.customer,subscriptions.customer),sub_id=excluded.sub_id,price=excluded.price,period_end=excluded.period_end,cancel_at_end=excluded.cancel_at_end,updated_at=excluded.updated_at`)
      .run(uid, plan, String(s.status || 'unknown'), s.customer || null, s.id, price, end, s.cancel_at_period_end ? 1 : 0, this.now());
    const nowActive = this.active(uid);
    // 新しい月に入ったら、手札確認チケットを付ける(設定で0枚なら付けない。同じ月は1回だけ)
    const peek = Number(this.core.cfg.PLAN_PEEK) || 0, ref = 'plan:' + s.id + ':' + end;
    if (peek > 0 && nowActive && ['active', 'trialing'].includes(s.status) && !this.db.prepare('SELECT 1 FROM peek_log WHERE ref=?').get(ref)) this.core.peekAdd(uid, peek, 'plan', ref);
    this.D.audit(null, 'plan_sync', uid, { why, status: s.status, end, cancelAtEnd: !!s.cancel_at_period_end });
    if (s.status === 'past_due' && (!before || before.status !== 'past_due')) this.core.notify(uid, 'plan', { msg: 'プランの支払いができませんでした。カードを確かめてください(3日間はそのまま使えます)' });
    else if (!wasActive && nowActive) this.core.notify(uid, 'plan', { msg: PLAN_JA[plan] + 'が使えるようになりました' });
    else if (wasActive && !nowActive) this.core.notify(uid, 'plan', { msg: PLAN_JA[plan] + 'が終了しました' });
    else if (s.cancel_at_period_end && !(before && before.cancel_at_end)) this.core.notify(uid, 'plan', { msg: '解約を受け付けました。' + new Date(end).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) + 'までは使えます' });
  }
  // 作成者・統括が見る一覧
  list(actor) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403);
    const rows = this.db.prepare('SELECT s.*,u.username FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.updated_at DESC').all();
    const act = rows.filter(r => this.active(r.user_id));
    return { ready: this.ready(), test: this.testMode(), open: !!this.core.cfg.BILLING, count: act.length, monthly: act.reduce((a, r) => a + (r.cancel_at_end ? 0 : (r.price || 0)), 0),
      rows: rows.map(r => ({ user: r.username, plan: PLAN_JA[r.plan], status: r.status, active: this.active(r.user_id), periodEnd: r.period_end, cancelAtEnd: !!r.cancel_at_end, price: r.price })) };
  }
}
module.exports = { Billing, PLAN_JA };
