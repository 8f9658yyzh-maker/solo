'use strict';
// 有料の特典(遊びの外側だけ。チップ・勝ちやすさ・ゲーム中の情報には一切関係しない)
// - 見た目テーマ: 卓の布と木枠の色。有料プランの間は全部使える。プランなしでも1つずつ買える(買い切り)
// - 単品の購入記録(user_items): 支払いごとに1回だけ。返金されたら使えなくなる
const { need } = require('./core');

const STAFF = ['creator', 'sovereign', 'manager'];
// 色そのものは画面側(web/app.js の THEMES)。ここでは名前と、買えるかどうかだけ
const THEMES = {
  classic: { name: '琉球藍', free: true },
  kariyushi: { name: 'かりゆし朱' },
  yaeyama: { name: '八重山の海' },
  tsuki: { name: '月夜' },
  kogane: { name: '黄金' }
};
const ITEMS = Object.fromEntries(Object.entries(THEMES).filter(([, t]) => !t.free).map(([k, t]) => ['theme_' + k, { kind: 'theme', theme: k, name: '卓のテーマ「' + t.name + '」' }]));

class Perks {
  constructor(D, core, billing) {
    this.D = D; this.db = D.db; this.core = core; this.billing = billing;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_items(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item TEXT NOT NULL, source TEXT NOT NULL, ref TEXT UNIQUE, payment TEXT, price INTEGER, ts INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ui_user ON user_items(user_id);
      CREATE TABLE IF NOT EXISTS user_prefs(user_id INTEGER PRIMARY KEY, theme TEXT);`);
  }
  item(id) { return ITEMS[id] || null; }
  price() { return this.core.cfg.PRICE_THEME; }
  plan(u) { return STAFF.includes(u.role) || !!(this.billing && this.billing.active(u.id)); }
  owns(uid, item) { return !!this.db.prepare('SELECT 1 FROM user_items WHERE user_id=? AND item=? AND revoked=0').get(uid, item); }
  themesOf(u) {
    if (this.plan(u)) return Object.keys(THEMES);
    const own = new Set(this.db.prepare('SELECT item FROM user_items WHERE user_id=? AND revoked=0').all(u.id).map(r => r.item));
    return Object.keys(THEMES).filter(k => THEMES[k].free || own.has('theme_' + k));
  }
  // 選んだテーマ。使えなくなった(プランが終わった・返金された)ときは標準に戻す
  theme(u) { const r = this.db.prepare('SELECT theme FROM user_prefs WHERE user_id=?').get(u.id); const t = r && r.theme; return t && this.themesOf(u).includes(t) ? t : 'classic'; }
  setTheme(u, theme) {
    need(THEMES[theme], 'そのテーマはありません', 404);
    need(this.themesOf(u).includes(theme), 'このテーマは、有料プランか購入で使えるようになります', 403);
    this.db.prepare('INSERT INTO user_prefs(user_id,theme) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme').run(u.id, theme);
    return { theme };
  }
  // 付与: 同じ支払い(ref)は1回だけ。戻り値 true=新しく付いた
  grant(uid, item, source, ref, payment, price) {
    need(ITEMS[item], '知らない商品です: ' + item);
    const r = this.db.prepare('INSERT OR IGNORE INTO user_items(user_id,item,source,ref,payment,price,ts) VALUES(?,?,?,?,?,?,?)').run(uid, item, source, ref || null, payment || null, price == null ? null : price, Date.now());
    if (r.changes) this.D.audit(null, 'item_grant', uid, { item, source, ref, price });
    return r.changes === 1;
  }
  // 返金: その支払いで付いたものを使えなくする
  revokeByPayment(payment) {
    if (!payment) return 0;
    const rows = this.db.prepare('SELECT * FROM user_items WHERE payment=? AND revoked=0').all(payment);
    for (const r of rows) { this.db.prepare('UPDATE user_items SET revoked=1 WHERE id=?').run(r.id); this.D.audit(null, 'item_revoke', r.user_id, { item: r.item, payment }); this.core.notify(r.user_id, 'plan', { msg: '返金にともない、' + ITEMS[r.item].name + 'は使えなくなりました' }); }
    return rows.length;
  }
  status(u) {
    const themes = this.themesOf(u), plan = this.plan(u);
    return {
      plan, theme: this.theme(u), themes,
      catalog: Object.entries(THEMES).map(([k, t]) => ({ id: k, name: t.name, free: !!t.free, have: themes.includes(k), item: t.free ? null : 'theme_' + k, owned: !t.free && this.owns(u.id, 'theme_' + k) })),
      price: this.price()
    };
  }
  // 作成者・統括が見る売上の一覧(単品)
  sales(actor) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403);
    const rows = this.db.prepare('SELECT i.*,u.username FROM user_items i JOIN users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 200').all();
    return { total: rows.filter(r => !r.revoked && r.price).reduce((a, r) => a + r.price, 0), rows: rows.map(r => ({ user: r.username, item: (ITEMS[r.item] || {}).name || r.item, price: r.price, ts: r.ts, revoked: !!r.revoked, source: r.source })) };
  }
}
module.exports = { Perks, THEMES, ITEMS };
