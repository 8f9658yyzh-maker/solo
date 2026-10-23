'use strict';
// チップの台帳。合計(供給量)は常に固定。口座名: u:<ユーザーID>=ポケット / s:<卓ID>:<ユーザーID>=卓のチップ / p:<卓ID>=卓の場(持ち越し)
const crypto = require('node:crypto');
const { ROLES } = require('./db');

class Ledger {
  constructor(D) { this.D = D; this.db = D.db; }
  supply() { return Number(this.D.getMeta('supply', 0)); }
  balance(acct) { const r = this.db.prepare('SELECT balance FROM accounts WHERE acct=?').get(acct); return r ? r.balance : 0; }
  total() { return this.db.prepare('SELECT COALESCE(SUM(balance),0) AS t FROM accounts').get().t; }
  // 不変条件: 口座の合計 = 供給量 かつ 台帳の合計 = 0 を超える分は供給量と一致
  check() {
    const sum = this.total(), sup = this.supply();
    const led = this.db.prepare('SELECT COALESCE(SUM(delta),0) AS t FROM ledger').get().t;
    const neg = this.db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE balance<0').get().c;
    return { ok: sum === sup && led === sup && neg === 0, accounts: sum, ledger: led, supply: sup, negative: neg };
  }
  // 複数口座の増減を1つのまとまり(tx)として記録。増減の合計は必ず0。
  move(entries, kind, o) {
    o = o || {};
    const sum = entries.reduce((a, e) => a + e.delta, 0);
    if (sum !== 0) throw new Error('増減の合計が0ではありません');
    for (const e of entries) if (!Number.isInteger(e.delta)) throw new Error('チップは整数です');
    const txid = crypto.randomBytes(8).toString('hex'), ts = Date.now();
    return this.D.tx(() => {
      const upd = this.db.prepare('INSERT INTO accounts(acct,balance) VALUES(?,0) ON CONFLICT(acct) DO NOTHING');
      const bump = this.db.prepare('UPDATE accounts SET balance=balance+? WHERE acct=?');
      const ins = this.db.prepare('INSERT INTO ledger(tx,ts,acct,delta,kind,actor_id,counter,ref,note) VALUES(?,?,?,?,?,?,?,?,?)');
      for (const e of entries) {
        if (e.delta === 0) continue;
        upd.run(e.acct);
        try { bump.run(e.delta, e.acct); } catch (err) { throw new Error('チップが足りません: ' + e.acct); }
        const others = entries.filter(x => x !== e && x.delta !== 0).map(x => x.acct).join(',');
        ins.run(txid, ts, e.acct, e.delta, kind, o.actor || null, others, o.ref || null, o.note || null);
      }
      return txid;
    });
  }
  transfer(from, to, amount, kind, o) {
    amount = Number(amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('チップは1以上の整数で入力してください');
    if (from === to) throw new Error('同じ口座には移せません');
    return this.move([{ acct: from, delta: -amount }, { acct: to, delta: amount }], kind, o);
  }
  // 最初の発行(作成者のポケットへ)。1回だけ。
  mint(creatorId, amount) {
    if (this.D.getMeta('minted', '0') === '1') throw new Error('すでに発行済みです');
    this.D.tx(() => {
      const ts = Date.now(), tx = crypto.randomBytes(8).toString('hex');
      this.db.prepare('INSERT INTO accounts(acct,balance) VALUES(?,?)').run('u:' + creatorId, amount);
      this.db.prepare('INSERT INTO ledger(tx,ts,acct,delta,kind,actor_id,counter,note) VALUES(?,?,?,?,?,?,?,?)').run(tx, ts, 'u:' + creatorId, amount, 'mint', creatorId, '', '初期発行');
      this.D.setMeta('supply', amount); this.D.setMeta('minted', '1');
    });
  }
  // 総量の変更は作成者だけ。差額は作成者のポケットで増減する。
  changeSupply(creatorId, newSupply) {
    newSupply = Number(newSupply);
    if (!Number.isInteger(newSupply) || newSupply <= 0) throw new Error('総量は1以上の整数です');
    return this.D.tx(() => {
      const diff = newSupply - this.supply();
      if (diff === 0) return;
      const me = 'u:' + creatorId;
      if (diff < 0 && this.balance(me) < -diff) throw new Error('作成者のポケットが足りないため、総量を減らせません');
      const ts = Date.now(), tx = crypto.randomBytes(8).toString('hex');
      this.db.prepare('INSERT INTO accounts(acct,balance) VALUES(?,0) ON CONFLICT(acct) DO NOTHING').run(me);
      this.db.prepare('UPDATE accounts SET balance=balance+? WHERE acct=?').run(diff, me);
      this.db.prepare('INSERT INTO ledger(tx,ts,acct,delta,kind,actor_id,counter,note) VALUES(?,?,?,?,?,?,?,?)').run(tx, ts, me, diff, 'supply_change', creatorId, '', '総量変更 ' + this.supply() + '→' + newSupply);
      this.D.setMeta('supply', newSupply);
      this.D.audit(creatorId, 'supply_change', null, { from: newSupply - diff, to: newSupply });
    });
  }
  // 自分の口座に関係する記録だけを返す(他人のポケットは見せない)
  history(acct, limit) {
    return this.db.prepare(`SELECT l.id,l.tx,l.ts,l.acct,l.delta,l.kind,l.actor_id,l.counter,l.note,u.username AS actor_name
      FROM ledger l LEFT JOIN users u ON u.id=l.actor_id WHERE l.acct=? ORDER BY l.id DESC LIMIT ?`).all(acct, limit || 100);
  }
}

// 権限: 誰が誰のポケットに触れるか
const rank = r => ROLES[r];
function canGive(actor, target) {   // actor が自分のポケットから target に配る
  if (actor.id === target.id) return false;
  if (actor.role === 'creator' || actor.role === 'sovereign') return true; // 作成者・統括は全員との間で動かせる
  if (actor.role === 'manager') return target.role === 'aj';
  if (actor.role === 'aj') return target.role === 'player' && target.parent_id === actor.id;
  return false;
}
function canPull(actor, target) {   // actor が target のポケットから自分に引き取る
  if (actor.id === target.id) return false;
  if (rank(actor.role) >= rank(target.role)) return false; // 上には触れない・同位にも触れない
  if (actor.role === 'creator' || actor.role === 'sovereign') return actor.role === 'creator' ? true : target.role !== 'creator';
  if (actor.role === 'manager') return target.role === 'aj' || target.role === 'player';
  if (actor.role === 'aj') return target.role === 'player' && target.parent_id === actor.id;
  return false;
}
module.exports = { Ledger, canGive, canPull, rank };
