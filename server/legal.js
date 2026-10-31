'use strict';
// 規約まわり: 利用規約・プライバシーポリシー・外部送信・特定商取引法の表記・広告主の募集のページと、利用規約への同意の記録。
// ページの文は web/legal/*.html。{{名前}} の所に、サーバーの環境変数と今の設定の値を入れて返す。
// 入っていない値は「【未記入】」と目に見える形で出す(空欄のまま公開しないため)。
const { need } = require('./core');

const TERMS_VERSION = '2026-10-31';   // 利用規約の版(登録したときの版を記録する。変えても遊ぶのは止めず、お知らせで伝える)
const PAGES = ['terms', 'privacy', 'external', 'tokushoho', 'sponsor'];
const BLANK = '<span class="blank">【未記入】</span>';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class Legal {
  constructor(D, core, env) {
    this.D = D; this.db = D.db; this.core = core; this.env = env || {};
    for (const col of ['terms_ver TEXT', 'terms_at INTEGER']) { try { this.db.exec('ALTER TABLE users ADD COLUMN ' + col); } catch (e) { /* すでにある */ } }
    core.onUserCreated = id => this.db.prepare('UPDATE users SET terms_ver=?,terms_at=? WHERE id=?').run(TERMS_VERSION, Date.now(), id);
  }
  version() { return TERMS_VERSION; }
  need(u) { const r = this.db.prepare('SELECT terms_ver FROM users WHERE id=?').get(u.id); return !r || r.terms_ver !== TERMS_VERSION; }
  agree(u, ver) {
    need(ver === TERMS_VERSION, '利用規約が新しくなっています。画面を読み込み直してください');
    this.db.prepare('UPDATE users SET terms_ver=?,terms_at=? WHERE id=?').run(TERMS_VERSION, Date.now(), u.id);
    this.D.audit(u.id, 'terms_agree', u.id, { ver: TERMS_VERSION });
    return { ok: true, ver: TERMS_VERSION };
  }
  // 差し込む値。環境変数(運営者・販売者の情報)と、今の設定(値段)
  vars() {
    const e = this.env, c = this.core.cfg, yen = n => Number(n).toLocaleString('ja-JP') + '円(税込)';
    return {
      SERVICE: 'SOLO(ソロ)', UPDATED: TERMS_VERSION.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日'),
      OPERATOR: e.LEGAL_OPERATOR, CONTACT: e.LEGAL_CONTACT, URL: e.PUBLIC_URL,
      SELLER_NAME: e.SELLER_NAME, SELLER_HEAD: e.SELLER_HEAD, SELLER_ADDRESS: e.SELLER_ADDRESS, SELLER_PHONE: e.SELLER_PHONE, SELLER_EMAIL: e.SELLER_EMAIL || e.LEGAL_CONTACT,
      PRICE_PLAYER: yen(c.PRICE_PLAYER), PRICE_AJ: yen(c.PRICE_AJ), PRICE_THEME: yen(c.PRICE_THEME),
      ADS_NET: c.AD_NET && e.ADSENSE_CLIENT ? 'あり(Google AdSense)' : 'なし(いまは使っていません)'
    };
  }
  render(name, tpl) {
    need(PAGES.includes(name), '見つかりません', 404);
    const v = this.vars();
    return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (v[k] == null || v[k] === '' ? BLANK : esc(v[k])));
  }
}
module.exports = { Legal, TERMS_VERSION, PAGES };
