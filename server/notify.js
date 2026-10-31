'use strict';
// かいとさんのスマホへ、音の鳴る知らせを送る(緊急のときだけ)
// 送り先は2つから選べる(両方入れれば両方へ):
//   ntfy(無料)      NTFY_TOPIC = 購読する名前(長く分かりにくい名前にする) / NTFY_TOKEN = ntfy のアカウントの合鍵(あれば。無料の回数がアカウントごとになる)
//   Pushover(買い切り) PUSHOVER_TOKEN = アプリの合鍵 / PUSHOVER_USER = 自分の番号。緊急は、押して確かめるまで30秒ごとに鳴り続ける
// 同じ知らせは gapMs のあいだ繰り返さない(鳴りっぱなしにしない)
class Notifier {
  constructor(env, o) {
    env = env || {}; o = o || {};
    this.ntfy = env.NTFY_TOPIC ? { topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN || '', server: (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '') } : null;
    this.po = env.PUSHOVER_TOKEN && env.PUSHOVER_USER ? { token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER } : null;
    this.fetch = o.fetch || ((...a) => fetch(...a)); this.now = o.now || (() => Date.now());
    this.last = new Map(); this.sent = [];
  }
  on() { return !!(this.ntfy || this.po); }
  // urgent=true: 鳴り続ける緊急 / false: ふつうの音
  async send(title, message, { urgent = true, key = null, gapMs = 30 * 60000 } = {}) {
    if (!this.on()) return false;
    if (key) { const t = this.last.get(key); if (t != null && this.now() - t < gapMs) return false; this.last.set(key, this.now()); }
    const jobs = [];
    if (this.ntfy) {
      const h = { 'Content-Type': 'application/json' }; if (this.ntfy.token) h.Authorization = 'Bearer ' + this.ntfy.token;
      jobs.push(this.post(this.ntfy.server + '/', h, JSON.stringify({ topic: this.ntfy.topic, title, message, priority: urgent ? 5 : 3, tags: [urgent ? 'rotating_light' : 'white_check_mark'] })));
    }
    if (this.po) {
      const b = new URLSearchParams({ token: this.po.token, user: this.po.user, title, message, priority: urgent ? '2' : '0', sound: urgent ? 'siren' : 'pushover' });
      if (urgent) { b.set('retry', '30'); b.set('expire', '1800'); }   // 押して確かめるまで30秒ごと・最長30分鳴らす
      jobs.push(this.post('https://api.pushover.net/1/messages.json', { 'Content-Type': 'application/x-www-form-urlencoded' }, b.toString()));
    }
    const r = await Promise.all(jobs); const ok = r.some(Boolean);
    this.sent.push({ t: this.now(), title, ok }); if (this.sent.length > 50) this.sent.shift();
    return ok;
  }
  async post(url, headers, body) {
    try {
      const r = await this.fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) console.error('★知らせを送れません', url.split('/')[2], r.status, (await r.text().catch(() => '')).slice(0, 200));
      return r.ok;
    } catch (e) { console.error('★知らせを送れません', url.split('/')[2], e.message); return false; }
  }
}
module.exports = { Notifier };
