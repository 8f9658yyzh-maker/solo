'use strict';
// 広告。2種類あります。
// 1) 地元スポンサー(直接契約): 作成者・統括が登録する。画像はこのサーバーから出すので、外の会社に利用者の情報は送られない
// 2) 広告会社(Google AdSense): サーバーに ADSENSE_CLIENT を入れ、設定で「使う」にしたときだけ。画面側が読み込む
// 決まり: ゲーム中の卓には出さない / 全画面は卓を出るときだけ・間隔をあける / 有料プランと作成者・統括には出さない / 広告の見返りにチップは出さない(総量が決まっているため)
const { need } = require('./core');

const DAY = 86400000;
const SLOTS = ['banner', 'full', 'both'];
const MAX_IMG = 300000;   // 画像(data URL)の上限。大きすぎるとページが重くなる

class Ads {
  constructor(D, core, billing, env) {
    env = env || {};
    this.D = D; this.db = D.db; this.core = core; this.billing = billing;
    this.client = /^ca-pub-\d{10,20}$/.test(env.ADSENSE_CLIENT || '') ? env.ADSENSE_CLIENT : '';
    this.slot = /^\d{6,14}$/.test(env.ADSENSE_SLOT || '') ? env.ADSENSE_SLOT : '';
    this.h5 = env.ADSENSE_H5 === '1';   // ゲーム用の全画面広告(H5 Games Ads)。Google の承認が出てから 1 にする
    this.now = env.clock || (() => Date.now());
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sponsors(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL, url TEXT, image TEXT, color TEXT, slot TEXT NOT NULL DEFAULT 'both',
        weight INTEGER NOT NULL DEFAULT 1, start_at INTEGER NOT NULL DEFAULT 0, end_at INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, note TEXT, created_by INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sponsor_stats(sponsor_id INTEGER NOT NULL, day TEXT NOT NULL, imp INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(sponsor_id,day));`);
  }
  top(u) { return u.role === 'creator' || u.role === 'sovereign'; }
  // この人に広告を出すか(サーバー側でも判定し、画面のいたずらで有料の人に出ることがないようにする)
  shows(u) { return !!(this.core.tablesOpt && this.core.tablesOpt.ads) && !this.top(u) && !(this.billing && this.billing.active(u.id)); }
  net() { return !!(this.core.cfg.AD_NET && this.client); }
  config(u) {
    const on = this.shows(u);
    return { on, gapMin: this.core.cfg.AD_GAP_MIN, net: on && this.net() ? { client: this.client, slot: this.slot, h5: this.h5 } : null };
  }
  day(ts) { return new Date(ts + 9 * 3600000).toISOString().slice(0, 10); }
  bump(id, col) { this.db.prepare(`INSERT INTO sponsor_stats(sponsor_id,day,${col}) VALUES(?,?,1) ON CONFLICT(sponsor_id,day) DO UPDATE SET ${col}=${col}+1`).run(id, this.day(this.now())); }
  live(slot) {
    const n = this.now();
    return this.db.prepare(`SELECT id,name,text,url,image,color,weight FROM sponsors WHERE active=1 AND (slot=? OR slot='both') AND (start_at=0 OR start_at<=?) AND (end_at=0 OR end_at>?)`).all(slot, n, n);
  }
  // 1つ選ぶ(重みつきの抽選)。選んだ時点で「表示1回」と数える
  pick(u, slot) {
    need(SLOTS.includes(slot) && slot !== 'both', '広告の場所が正しくありません');
    if (!this.shows(u)) return { ad: null };
    const list = this.live(slot); if (!list.length) return { ad: null };
    let r = Math.random() * list.reduce((a, x) => a + x.weight, 0), pick = list[0];
    for (const x of list) { r -= x.weight; if (r < 0) { pick = x; break; } }
    this.bump(pick.id, 'imp');
    return { ad: { id: pick.id, name: pick.name, text: pick.text, url: pick.url, image: pick.image, color: pick.color } };
  }
  click(u, id) {
    const s = this.db.prepare('SELECT id,url FROM sponsors WHERE id=? AND active=1').get(Number(id));
    need(s && s.url, '広告が見つかりません', 404);
    this.bump(s.id, 'clicks'); return { url: s.url };
  }
  // ---- 管理(作成者・統括) ----
  clean(b, prev) {
    const o = Object.assign({}, prev || {}, b || {}), str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    const out = { name: str(o.name, 30), text: str(o.text, 60), url: str(o.url, 300), image: o.image ? String(o.image) : null, color: str(o.color, 7) || null, slot: SLOTS.includes(o.slot) ? o.slot : 'both',
      weight: Math.max(1, Math.min(10, Math.floor(Number(o.weight) || 1))), start_at: Math.max(0, Math.floor(Number(o.start_at) || 0)), end_at: Math.max(0, Math.floor(Number(o.end_at) || 0)),
      active: o.active === false || o.active === 0 ? 0 : 1, note: str(o.note, 200) };
    need(out.name, 'スポンサーの名前を入れてください'); need(out.text, '広告の文を入れてください');
    need(!out.url || /^https:\/\/[^\s"'<>]+$/.test(out.url), 'リンク先は https:// で始まるアドレスにしてください');
    need(!out.image || (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(out.image) && out.image.length <= MAX_IMG), '画像は PNG・JPEG・WebP で、約200KBまでにしてください');
    need(!out.color || /^#[0-9A-Fa-f]{6}$/.test(out.color), '色は #RRGGBB の形で入れてください');
    need(!out.end_at || out.end_at > out.start_at, '終わりの日は、始まりの日より後にしてください');
    return out;
  }
  create(actor, b) {
    need(this.top(actor), '権限がありません', 403);
    const o = this.clean(b);
    const r = this.db.prepare('INSERT INTO sponsors(name,text,url,image,color,slot,weight,start_at,end_at,active,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(o.name, o.text, o.url || null, o.image, o.color, o.slot, o.weight, o.start_at, o.end_at, o.active, o.note, actor.id, this.now());
    this.D.audit(actor.id, 'sponsor_add', Number(r.lastInsertRowid), { name: o.name });
    return { id: Number(r.lastInsertRowid) };
  }
  update(actor, id, b) {
    need(this.top(actor), '権限がありません', 403);
    const prev = this.db.prepare('SELECT * FROM sponsors WHERE id=?').get(Number(id)); need(prev, '見つかりません', 404);
    const o = this.clean(b, prev);
    this.db.prepare('UPDATE sponsors SET name=?,text=?,url=?,image=?,color=?,slot=?,weight=?,start_at=?,end_at=?,active=?,note=? WHERE id=?')
      .run(o.name, o.text, o.url || null, o.image, o.color, o.slot, o.weight, o.start_at, o.end_at, o.active, o.note, prev.id);
    this.D.audit(actor.id, 'sponsor_edit', prev.id, { name: o.name, active: o.active });
    return { ok: true };
  }
  // 一覧と、請求のための数字(表示回数・クリック数。日ごと)
  list(actor, days = 30) {
    need(this.top(actor), '権限がありません', 403);
    const from = this.day(this.now() - (days - 1) * DAY);
    return this.db.prepare('SELECT * FROM sponsors ORDER BY active DESC, id DESC').all().map(s => {
      const st = this.db.prepare('SELECT day,imp,clicks FROM sponsor_stats WHERE sponsor_id=? AND day>=? ORDER BY day').all(s.id, from);
      const all = this.db.prepare('SELECT COALESCE(SUM(imp),0) AS imp, COALESCE(SUM(clicks),0) AS clicks FROM sponsor_stats WHERE sponsor_id=?').get(s.id);
      return Object.assign(s, { image: s.image ? true : false, recent: st, imp30: st.reduce((a, x) => a + x.imp, 0), clicks30: st.reduce((a, x) => a + x.clicks, 0), impAll: all.imp, clicksAll: all.clicks });
    });
  }
  image(actor, id) { need(this.top(actor), '権限がありません', 403); const s = this.db.prepare('SELECT image FROM sponsors WHERE id=?').get(Number(id)); need(s, '見つかりません', 404); return { image: s.image }; }
  // ads.txt: 広告会社が「このサイトの広告枠を売ってよい会社」を確かめるファイル
  adsTxt() { return this.client ? `google.com, ${this.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : ''; }
}
module.exports = { Ads };
