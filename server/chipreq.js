'use strict';
// チップの申請: AJ・ゲーム管理責任者が、上の立場(自分を招待した人)にチップを頼む。承認すると、その人のポケットから配る。
// プレイヤーからは申請できない(アプリの外でお金と引き換えにチップを頼む窓口にしないため。プレイヤーには直のAJが配る)。
const { need } = require('./core');

const OPEN_MAX = 3;
class ChipRequests {
  constructor(D, core) {
    this.D = D; this.db = D.db; this.core = core;
    this.db.exec(`CREATE TABLE IF NOT EXISTS chip_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, amount INTEGER NOT NULL, note TEXT,
      status TEXT NOT NULL DEFAULT 'open', ts INTEGER NOT NULL, decided_at INTEGER, decided_by INTEGER, reply TEXT);
      CREATE INDEX IF NOT EXISTS cr_to ON chip_requests(to_id,status);`);
  }
  top(u) { return u.role === 'creator' || u.role === 'sovereign'; }
  // 申請の宛先: 自分を招待した人。作成者・統括あてのものは、2人とも見られる(ポケットが共通のため)
  create(actor, amount, note) {
    need(actor.role === 'aj' || actor.role === 'manager', 'チップの申請ができるのは、AJとゲーム管理責任者です', 403);
    const to = actor.parent_id && this.core.user(actor.parent_id); need(to && to.status !== 'banned', '申請先が見つかりません', 404);
    amount = Number(amount); need(Number.isInteger(amount) && amount >= 1 && amount <= 100000000, 'チップは1〜1億の整数で入れてください');
    need(this.db.prepare("SELECT COUNT(*) AS c FROM chip_requests WHERE from_id=? AND status='open'").get(actor.id).c < OPEN_MAX, `返事を待っている申請が${OPEN_MAX}件あります。返事が来てから出してください`);
    const r = this.db.prepare('INSERT INTO chip_requests(from_id,to_id,amount,note,ts) VALUES(?,?,?,?,?)').run(actor.id, to.id, amount, String(note || '').trim().slice(0, 200) || null, Date.now());
    const id = Number(r.lastInsertRowid), body = { id, from: actor.username, amount };
    if (this.top(to)) this.core.notifyRole(['creator', 'sovereign'], 'chipreq', body); else this.core.notify(to.id, 'chipreq', body);
    this.D.audit(actor.id, 'chipreq', to.id, { id, amount });
    return { id };
  }
  inboxWhere(actor) {
    if (this.top(actor)) return { sql: "to_id IN (SELECT id FROM users WHERE role IN ('creator','sovereign'))", args: [] };
    return { sql: 'to_id=?', args: [actor.id] };
  }
  list(actor) {
    const w = this.inboxWhere(actor), cols = 'r.*,f.username AS from_name,f.role AS from_role,t.username AS to_name';
    const inbox = this.db.prepare(`SELECT ${cols} FROM chip_requests r JOIN users f ON f.id=r.from_id JOIN users t ON t.id=r.to_id WHERE r.${w.sql} ORDER BY r.status='open' DESC, r.id DESC LIMIT 100`).all(...w.args);
    const mine = this.db.prepare(`SELECT ${cols} FROM chip_requests r JOIN users f ON f.id=r.from_id JOIN users t ON t.id=r.to_id WHERE r.from_id=? ORDER BY r.id DESC LIMIT 30`).all(actor.id);
    return { canAsk: actor.role === 'aj' || actor.role === 'manager', inbox, mine };
  }
  decide(actor, id, approve, reply) {
    const r = this.db.prepare('SELECT * FROM chip_requests WHERE id=?').get(Number(id)); need(r, '見つかりません', 404);
    const w = this.inboxWhere(actor);
    need(this.db.prepare(`SELECT 1 FROM chip_requests WHERE id=? AND ${w.sql}`).get(r.id, ...w.args), 'あなたあての申請ではありません', 403);
    need(r.status === 'open', 'この申請には、もう返事をしています');
    const set = st => this.db.prepare('UPDATE chip_requests SET status=?,decided_at=?,decided_by=?,reply=? WHERE id=?').run(st, Date.now(), actor.id, String(reply || '').trim().slice(0, 200) || null, r.id);
    if (approve) this.D.tx(() => { this.core.give(actor, r.from_id, r.amount, 'チップの申請 #' + r.id); set('approved'); });   // 配れない(足りない・権限がない)ときは、申請も「待ち」のまま
    else set('declined');
    this.core.notify(r.from_id, 'chipreq_done', { id: r.id, amount: r.amount, ok: !!approve, by: actor.username });
    return { ok: true };
  }
  cancel(actor, id) {
    const r = this.db.prepare("UPDATE chip_requests SET status='canceled',decided_at=? WHERE id=? AND from_id=? AND status='open'").run(Date.now(), Number(id), actor.id);
    need(r.changes === 1, '取り消せる申請がありません'); return { ok: true };
  }
}
module.exports = { ChipRequests };
