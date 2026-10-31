'use strict';
const crypto = require('node:crypto');
const { ROLES, ROLE_JA, rand, randDigits, SUPPLY_DEFAULT } = require('./db');
const { Ledger, canGive, canPull } = require('./ledger');

const CFG = {
  NUISANCE_LIMIT: 3,           // 迷惑行為(流れた試合の不参加で戻らない等)がこの回数で自動退会
  ENTRY_FEE_FIRST: 1000,       // 参加費: 1日の1回目・2回目
  ENTRY_FEE_NEXT: 500,         // 参加費: 3回目から
  FEE_NOTICE_STEP: 5000,       // 保管がこの額をこえるたびに受け取りの通知
  REPORT_THRESHOLD: 3,         // 同じ人への通報者(別々の人)がこの数になると監視対象
  SUSPICION_THRESHOLD: 5,      // 疑わしい行動がこの回数になると「要チェック」
  HOUSE_PASS_MS: 5 * 60 * 1000,
  JOIN_MAX_TRIES: 5, JOIN_WINDOW_MS: 10 * 60 * 1000,
  SESSION_MS: 14 * 24 * 3600 * 1000,
  INVITE_MS: 7 * 24 * 3600 * 1000,
  TABLE_LIMIT_DEFAULT: 6,
  BILLING: 0,                  // 有料プランの申し込みを受け付けるか(試験運用中は0)
  PRICE_PLAYER: 680,           // 一般プランの月額(円)
  PRICE_AJ: 1480,              // AJプランの月額(円)
  PRICE_THEME: 300,            // 卓のテーマ1つの値段(円・買い切り)
  PLAN_PEEK: 0,                // 有料プランの更新ごとに付ける手札確認チケットの枚数(0=付けない。弁護士の確認まで0)
  AD_NET: 0,                   // 広告会社(Google AdSense)の広告も出すか(0=地元スポンサーだけ)
  AD_GAP_MIN: 10,              // 全画面の広告の間隔(分)
};
class Err extends Error { constructor(m, code) { super(m); this.code = code || 400; } }
const need = (c, m, code) => { if (!c) throw new Err(m, code); };

const STAFF = ['creator', 'sovereign', 'manager'];
class Core {
  constructor(D, opts) {
    this.D = D; this.db = D.db; this.L = new Ledger(D);
    this.cfg = Object.assign({}, CFG, opts || {});
    this.pepper = D.getMeta('pepper', null) || (() => { const p = rand(16); D.setMeta('pepper', p); return p; })();
    this.onUserBanned = null; // 卓側が登録する
  }
  // ---------- 基本 ----------
  user(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  userByName(n) { return this.db.prepare('SELECT * FROM users WHERE username=?').get(String(n || '')); }
  pub(u) { return u && { id: u.id, username: u.username, role: u.role, parent_id: u.parent_id, status: u.status }; }
  hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
  // 非同期版: 計算中も他の卓の処理が止まらない(本番のHTTPはこちらを使う)
  hashPwAsync(pw, salt) { return new Promise((ok, ng) => crypto.scrypt(pw, salt, 32, (e, k) => e ? ng(e) : ok(k.toString('hex')))); }
  async loginAsync(o) {
    const u = this.userByName(o.username);
    const hash = u ? await this.hashPwAsync(String(o.password || ''), u.pass_salt) : null;
    return this.login(Object.assign({}, o, { _hash: hash }));
  }
  // ---- パスワードの再設定: 上の立場の人がコードを出し、本人がそのコードで新しいパスワードを決める(上の人はパスワードを知らないまま) ----
  createReset(actor, targetId) {
    const t = this.user(Number(targetId)); need(t, '相手が見つかりません', 404);
    need(canPull(actor, t), 'この人のパスワードの再設定はできません', 403);   // 誰が誰に触れるかは、チップを引き取れる関係と同じ(上の立場から下へ)
    need(t.status !== 'banned', '退会処分の人です');
    const now = Date.now(), code = rand(5).toUpperCase();
    this.D.tx(() => {
      this.db.prepare('UPDATE pw_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now, t.id);   // 前に出したコードは使えなくする
      this.db.prepare('INSERT INTO pw_resets(code,user_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?)').run(code, t.id, actor.id, now, now + 24 * 3600000);
      this.D.audit(actor.id, 'pw_reset_code', t.id);
    });
    return { code, username: t.username, expiresAt: now + 24 * 3600000 };
  }
  async resetPasswordAsync({ code, username, password }) {
    const r = this.db.prepare('SELECT * FROM pw_resets WHERE code=?').get(String(code || '').trim().toUpperCase()), u = this.userByName(String(username || '').trim());
    need(r && u && r.user_id === u.id && !r.used_at && r.expires_at > Date.now(), '再設定コードかユーザー名が違うか、コードの期限(24時間)が切れています', 400);
    need(String(password || '').length >= 8, 'パスワードは8文字以上です');
    const salt = rand(16), hash = await this.hashPwAsync(String(password), salt);
    this.D.tx(() => {
      const ok = this.db.prepare('UPDATE pw_resets SET used_at=? WHERE code=? AND used_at IS NULL').run(Date.now(), r.code).changes;
      need(ok === 1, 'このコードはもう使われています');
      this.db.prepare('UPDATE users SET pass_hash=?,pass_salt=? WHERE id=?').run(hash, salt, u.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);   // ほかの端末のログインも切る(盗まれていた場合に備えて)
      this.D.audit(u.id, 'pw_reset', u.id, { by: r.created_by });
    });
    return { ok: true };
  }
  async signupAsync(o) {
    const salt = rand(16);
    const hash = String(o.password || '').length >= 8 ? await this.hashPwAsync(o.password, salt) : null;
    return this.signup(Object.assign({}, o, { _salt: salt, _hash: hash }));
  }
  hashPhone(p) { return crypto.createHash('sha256').update(this.pepper + '|' + p).digest('hex'); }
  normPhone(p) {
    let s = String(p || '').replace(/[\s\-()]/g, '');
    if (s.startsWith('+81')) s = '0' + s.slice(3);
    need(/^0\d{9,10}$/.test(s), '電話番号の形式が正しくありません(例 09012345678)');
    return s;
  }
  notify(toUser, kind, body) { this.db.prepare('INSERT INTO notifications(to_user,kind,body,ts) VALUES(?,?,?,?)').run(toUser, kind, JSON.stringify(body), Date.now()); }
  notifyRole(roles, kind, body) { for (const u of this.db.prepare(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND status!='banned'`).all(...roles)) this.notify(u.id, kind, body); }

  // ---------- 最初の作成者 ----------
  bootstrap(username, password, phone) {
    need(!this.db.prepare("SELECT 1 FROM users WHERE role='creator'").get(), '作成者はすでにいます');
    return this.D.tx(() => {
      const id = this._insertUser(username, password, 'creator', null, phone || null);
      this.L.mint(id, SUPPLY_DEFAULT);
      this.D.audit(id, 'bootstrap', id);
      return id;
    });
  }
  _insertUser(username, password, role, parent, phone, pre) {
    need(/^[A-Za-z0-9_\-ぁ-んァ-ヶ一-龠ー]{3,20}$/.test(username || ''), 'ユーザー名は3〜20文字(英数字・かな・漢字・_ -)です');
    need(String(password || '').length >= 8, 'パスワードは8文字以上です');
    need(!this.userByName(username), 'そのユーザー名はすでに使われています');
    const salt = pre && pre.salt || rand(16);
    const r = this.db.prepare('INSERT INTO users(username,pass_hash,pass_salt,role,parent_id,phone_hash,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(username, pre && pre.hash || this.hashPw(password, salt), salt, role, parent, phone ? this.hashPhone(this.normPhone(phone)) : null, Date.now());
    const id = Number(r.lastInsertRowid);
    if (this.onUserCreated) this.onUserCreated(id);   // 登録時の同意(利用規約の版)を記録する。登録画面では「18歳以上・利用規約に同意」が必須
    if (role === 'aj') this._ensureHouse(id, username);
    return id;
  }

  // ---------- 招待・登録 ----------
  createInvite(actor, role) {
    const allowed = { creator: ['sovereign', 'manager', 'aj', 'player'], sovereign: ['manager', 'aj', 'player'], manager: ['aj'], aj: ['player'] }[actor.role] || [];
    need(allowed.includes(role), `${ROLE_JA[actor.role]}は${ROLE_JA[role] || role}を招待できません`, 403);
    const code = rand(5).toUpperCase();
    this.db.prepare('INSERT INTO invites(code,created_by,role,created_at,expires_at) VALUES(?,?,?,?,?)').run(code, actor.id, role, Date.now(), Date.now() + this.cfg.INVITE_MS);
    this.D.audit(actor.id, 'invite', code, { role });
    return { code, role };
  }
  signup({ invite, username, password, phone, deviceId, ip, _salt, _hash }) {
    need(deviceId && String(deviceId).length >= 8, '端末の識別情報がありません');
    need(!this.ipBlocked(ip, username), 'このネットワークからは登録できません。統括責任者か作成者の許可が必要です', 403);
    return this.D.tx(() => {
      const inv = this.db.prepare('SELECT * FROM invites WHERE code=?').get(String(invite || '').toUpperCase());
      need(inv && !inv.used_by && inv.expires_at > Date.now(), '招待コードが無効か、期限切れです');
      const ph = this.normPhone(phone);
      need(!this.db.prepare('SELECT 1 FROM users WHERE phone_hash=?').get(this.hashPhone(ph)), 'この電話番号はすでに登録されています(1つの電話番号につきアカウントは1つです)');
      const dup = this.db.prepare('SELECT DISTINCT user_id FROM devices WHERE device_id=?').all(deviceId);
      need(dup.length === 0, 'この端末ではすでに別のアカウントが使われています(アカウントは1人1つです)');
      const id = this._insertUser(username, password, inv.role, inv.created_by, ph, _hash ? { salt: _salt, hash: _hash } : null);
      this.db.prepare('UPDATE invites SET used_by=? WHERE code=?').run(id, inv.code);
      this._touchDevice(id, deviceId, ip);
      const par = this.user(inv.created_by);
      if (inv.role === 'player' && par.role === 'aj') this._addMember(par.id, id);
      this.D.audit(id, 'signup', id, { by: inv.created_by, ip });
      return this.pub(this.user(id));
    });
  }
  ipBlocked(ip, username) {
    if (!ip) return false;
    const b = this.db.prepare('SELECT 1 FROM banned_ips WHERE ip=?').get(ip);
    if (!b) return false;
    return !this.db.prepare('SELECT 1 FROM ip_permits WHERE ip=? AND username=?').get(ip, username || '');
  }
  _touchDevice(userId, deviceId, ip) {
    const now = Date.now();
    this.db.prepare('INSERT INTO devices(user_id,device_id,ip,first_seen,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(user_id,device_id,ip) DO UPDATE SET last_seen=excluded.last_seen').run(userId, deviceId, ip || '', now, now);
  }
  login({ username, password, deviceId, ip, _hash }) {
    const u = this.userByName(username);
    need(u && crypto.timingSafeEqual(Buffer.from(_hash || this.hashPw(String(password || ''), u.pass_salt), 'hex'), Buffer.from(u.pass_hash, 'hex')), 'ユーザー名かパスワードが違います', 401);
    need(u.status !== 'banned', 'このアカウントは退会処分になっています', 403);
    need(!this.ipBlocked(ip, u.username), 'このネットワークからはログインできません。統括責任者か作成者の許可が必要です', 403);
    need(deviceId && String(deviceId).length >= 8, '端末の識別情報がありません');
    // 別アカウントの端末から入った場合は拒否せず、記録して疑いに数える
    const others = this.db.prepare('SELECT DISTINCT user_id FROM devices WHERE device_id=? AND user_id!=?').all(deviceId, u.id);
    this._touchDevice(u.id, deviceId, ip);
    if (others.length) this.suspect(u.id, 'same_device', { with: others.map(o => o.user_id) });
    const token = rand(24);
    this.db.prepare('INSERT INTO sessions(token,user_id,ip,created_at,expires_at) VALUES(?,?,?,?,?)').run(token, u.id, ip || '', Date.now(), Date.now() + this.cfg.SESSION_MS);
    this.D.audit(u.id, 'login', u.id, { ip });
    return { token, user: this.pub(u) };
  }
  auth(token) {
    if (!token) return null;
    const s = this.db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?').get(token, Date.now());
    if (!s) return null;
    const u = this.user(s.user_id);
    return u && u.status !== 'banned' ? u : null;
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token=?').run(token); }

  // ---------- チップ ----------
  // 作成者と統括責任者のポケットは1つを共有する(どちらからでも使え、同じ残高が見える)
  creatorId() { if (this._cid == null) { const r = this.db.prepare("SELECT id FROM users WHERE role='creator'").get(); this._cid = r ? r.id : null; } return this._cid; }
  acct(userId) { const u = this.user(userId); return 'u:' + (u && (u.role === 'creator' || u.role === 'sovereign') && this.creatorId() ? this.creatorId() : userId); }
  pocket(userId) { return this.L.balance(this.acct(userId)); }
  give(actor, toId, amount, note) {
    const t = this.user(toId); need(t, '相手が見つかりません', 404);
    need(canGive(actor, t), 'この相手にはチップを渡せません', 403);
    need(t.status !== 'banned', '退会処分の相手には渡せません');
    need(this.acct(actor.id) !== this.acct(t.id), '作成者と統括責任者のポケットは共有です(渡す必要はありません)');
    amount = Number(amount); need(Number.isInteger(amount) && amount > 0, 'チップは1以上の整数で入力してください');
    need(this.L.balance(this.acct(actor.id)) >= amount, 'ポケットのチップが足りません');   // 台帳の側でも止まるが、利用者には「足りない」と返す(サーバーの故障として数えない)
    const tx = this.L.transfer(this.acct(actor.id), this.acct(t.id), amount, 'give', { actor: actor.id, note });
    this.D.audit(actor.id, 'give', t.id, { amount, tx });
    return { tx, balance: this.pocket(actor.id) };
  }
  pull(actor, fromId, amount, note) {
    const t = this.user(fromId); need(t, '相手が見つかりません', 404);
    need(canPull(actor, t), 'この相手のポケットからは引き取れません', 403);
    amount = Number(amount); need(Number.isInteger(amount) && amount > 0, 'チップは1以上の整数で入力してください');
    need(this.L.balance(this.acct(t.id)) >= amount, '相手のポケットのチップが足りません');
    const tx = this.L.transfer(this.acct(t.id), this.acct(actor.id), amount, 'pull', { actor: actor.id, note });
    this.D.audit(actor.id, 'pull', t.id, { amount, tx });
    this.notify(t.id, 'pulled', { by: actor.username, amount });
    return { tx, balance: this.pocket(actor.id) };
  }
  // 見てよい範囲のユーザー一覧(残高つき)
  visibleUsers(actor) {
    let rows;
    if (actor.role === 'creator' || actor.role === 'sovereign') rows = this.db.prepare('SELECT * FROM users WHERE id!=? ORDER BY role,id').all(actor.id);
    else if (actor.role === 'manager') rows = this.db.prepare("SELECT * FROM users WHERE role IN ('aj','player') ORDER BY role,id").all();
    else if (actor.role === 'aj') rows = this.db.prepare('SELECT * FROM users WHERE parent_id=? ORDER BY id').all(actor.id);
    else rows = [];
    return rows.map(u => Object.assign(this.pub(u), { balance: this.pocket(u.id), parent_name: u.parent_id ? (this.user(u.parent_id) || {}).username : null }));
  }
  // 自分の履歴。ほかの人のポケットの記録は、自分が当事者のものだけ。
  myLedger(actor, limit) {
    return this.L.history(this.acct(actor.id), limit).map(r => ({
      id: r.id, ts: r.ts, delta: r.delta, kind: r.kind, note: r.note,
      by: r.actor_id && r.actor_id !== actor.id ? r.actor_name : null,
      counter: String(r.counter || '').split(',').filter(Boolean).map(a => this.acctLabel(a)).join(', ')
    }));
  }
  acctLabel(a) {
    if (a.startsWith('u:')) { const id = Number(a.slice(2)); const u = this.user(id); return u ? (u.role === 'creator' ? '作成者・統括責任者の共有' : u.username) : a; }
    if (a.startsWith('f:')) return '卓' + a.slice(2) + 'の保管(手数料・参加費)';
    if (a.startsWith('s:')) return '卓' + a.split(':')[1] + 'のチップ';
    if (a.startsWith('p:')) return '卓' + a.slice(2) + 'の場';
    return a;
  }
  // 作成者・統括だけが、全体の記録を見られる
  fullLedger(actor, limit) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '見られる権限がありません', 403);
    return this.db.prepare('SELECT id,tx,ts,acct,delta,kind,actor_id,counter,note FROM ledger ORDER BY id DESC LIMIT ?').all(limit || 200);
  }

  // ---------- ハウス ----------
  _ensureHouse(ownerId, name) {
    let h = this.db.prepare('SELECT * FROM houses WHERE owner_id=?').get(ownerId);
    if (h) return h;
    const id = randDigits(6);
    this.db.prepare('INSERT INTO houses(id,owner_id,name,join_pass,pass_exp,table_limit,created_at) VALUES(?,?,?,?,?,?,?)').run(id, ownerId, name + 'のハウス', null, 0, this.cfg.TABLE_LIMIT_DEFAULT, Date.now());
    this._addMember(ownerId, ownerId, id);
    return this.db.prepare('SELECT * FROM houses WHERE id=?').get(id);
  }
  _addMember(ajId, userId, houseId) {
    const h = houseId || this.db.prepare('SELECT id FROM houses WHERE owner_id=?').get(ajId).id;
    this.db.prepare('INSERT OR IGNORE INTO house_members(house_id,user_id,joined_at) VALUES(?,?,?)').run(h, userId, Date.now());
  }
  houseOf(userId) { return this.db.prepare('SELECT * FROM houses WHERE owner_id=?').get(userId); }
  homeHouseId(u) {   // 直のAJのハウス
    if (u.role === 'aj') return (this.houseOf(u.id) || {}).id;
    const p = u.parent_id && this.user(u.parent_id);
    return p && p.role === 'aj' ? (this.houseOf(p.id) || {}).id : null;
  }
  // 入室パスワードは5分で作り直す。AJ本人だけが見られる。
  housePassword(actor) {
    need(actor.role === 'aj', 'ハウスのパスワードを見られるのはAJだけです', 403);
    const h = this.houseOf(actor.id);
    if (!h.join_pass || h.pass_exp <= Date.now()) {
      const p = randDigits(6), exp = Date.now() + this.cfg.HOUSE_PASS_MS;
      this.db.prepare('UPDATE houses SET join_pass=?,pass_exp=? WHERE id=?').run(p, exp, h.id);
      return { houseId: h.id, name: h.name, password: p, expiresAt: exp };
    }
    return { houseId: h.id, name: h.name, password: h.join_pass, expiresAt: h.pass_exp };
  }
  joinHouse(actor, houseId, password) {
    const now = Date.now();
    this.db.prepare('DELETE FROM join_attempts WHERE ts<?').run(now - this.cfg.JOIN_WINDOW_MS);
    const tries = this.db.prepare('SELECT COUNT(*) AS c FROM join_attempts WHERE user_id=?').get(actor.id).c;
    need(tries < this.cfg.JOIN_MAX_TRIES, '試行回数が多すぎます。しばらく待ってからやり直してください', 429);
    this.db.prepare('INSERT INTO join_attempts(user_id,ts) VALUES(?,?)').run(actor.id, now);
    const h = this.db.prepare('SELECT * FROM houses WHERE id=?').get(String(houseId || ''));
    const okPw = h && h.join_pass && h.pass_exp > now && String(password || '').length === h.join_pass.length &&
      crypto.timingSafeEqual(Buffer.from(String(password)), Buffer.from(h.join_pass));
    need(okPw, 'ハウスIDかパスワードが違うか、パスワードの期限が切れています', 403);
    need(h.owner_id !== actor.id || true, '');
    this._addMember(h.owner_id, actor.id, h.id);
    this.db.prepare('DELETE FROM join_attempts WHERE user_id=?').run(actor.id);
    this.D.audit(actor.id, 'join_house', h.id);
    return { houseId: h.id, name: h.name };
  }
  myHouses(actor) {
    return this.db.prepare(`SELECT h.id,h.name,h.owner_id,u.username AS owner_name FROM house_members m JOIN houses h ON h.id=m.house_id JOIN users u ON u.id=h.owner_id WHERE m.user_id=? ORDER BY m.joined_at`).all(actor.id)
      .map(h => Object.assign(h, { home: h.id === this.homeHouseId(actor) }));
  }
  leaveHouse(actor, houseId) {
    need(houseId !== this.homeHouseId(actor), '自分の所属ハウスからは抜けられません');
    this.db.prepare('DELETE FROM house_members WHERE house_id=? AND user_id=?').run(houseId, actor.id);
  }
  kickFromHouse(actor, userId) {
    need(actor.role === 'aj', 'AJだけが実行できます', 403);
    const h = this.houseOf(actor.id), t = this.user(userId);
    need(t && t.id !== actor.id, '対象が不正です');
    need(t.parent_id !== actor.id, '自分の直のプレイヤーは外せません(停止はお問い合わせください)');
    need(this.isMember(userId, h.id), 'そのプレイヤーはこのハウスにいません', 404);
    this.db.prepare('DELETE FROM house_members WHERE house_id=? AND user_id=?').run(h.id, userId);
    this.D.audit(actor.id, 'kick', userId, { house: h.id });
    return true;
  }
  isMember(userId, houseId) { return !!this.db.prepare('SELECT 1 FROM house_members WHERE house_id=? AND user_id=?').get(houseId, userId); }
  houseMembers(actor) {
    const h = this.houseOf(actor.id); need(h, 'ハウスがありません', 403);
    return this.db.prepare('SELECT u.id,u.username,u.role,u.parent_id,u.status FROM house_members m JOIN users u ON u.id=m.user_id WHERE m.house_id=? ORDER BY m.joined_at').all(h.id)
      .map(m => Object.assign(m, { direct: m.parent_id === actor.id, balance: m.parent_id === actor.id ? this.pocket(m.id) : null }));
  }

  // ---------- 卓の上限 ----------
  tableCount(houseId) { return this.db.prepare("SELECT COUNT(*) AS c FROM tables_ WHERE house_id=? AND status IN ('open','running')").get(houseId).c; }
  requestLimit(actor, reason) {
    need(actor.role === 'aj', 'AJだけが申請できます', 403);
    const r = this.db.prepare("INSERT INTO limit_requests(aj_id,reason,stage,status,ts) VALUES(?,?, 'manager','open',?)").run(actor.id, String(reason || '').slice(0, 300), Date.now());
    this.notifyRole(['manager'], 'limit_request', { aj: actor.username, reason, id: Number(r.lastInsertRowid) });
    return Number(r.lastInsertRowid);
  }
  forwardLimit(actor, id) {
    need(actor.role === 'manager', 'ゲーム管理責任者だけが取り次げます', 403);
    const r = this.db.prepare("SELECT * FROM limit_requests WHERE id=? AND stage='manager' AND status='open'").get(id); need(r, '申請が見つかりません', 404);
    this.db.prepare("UPDATE limit_requests SET stage='top' WHERE id=?").run(id);
    this.notifyRole(['creator', 'sovereign'], 'limit_request', { aj: this.user(r.aj_id).username, id });
  }
  decideLimit(actor, id, newLimit, approve) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '作成者か統括責任者だけが決められます', 403);
    const r = this.db.prepare("SELECT * FROM limit_requests WHERE id=? AND stage='top' AND status='open'").get(id); need(r, '申請が見つかりません', 404);
    if (approve) {
      newLimit = Number(newLimit); need(Number.isInteger(newLimit) && newLimit >= 1 && newLimit <= 100, '上限は1〜100の整数です');
      this.db.prepare('UPDATE houses SET table_limit=? WHERE owner_id=?').run(newLimit, r.aj_id);
    }
    this.db.prepare('UPDATE limit_requests SET status=?,new_limit=? WHERE id=?').run(approve ? 'approved' : 'rejected', approve ? newLimit : null, id);
    this.notify(r.aj_id, 'limit_result', { approved: !!approve, newLimit });
    this.D.audit(actor.id, 'limit_decision', r.aj_id, { approve, newLimit });
  }
  listLimitRequests(actor) {
    if (actor.role === 'manager') return this.db.prepare("SELECT r.*,u.username AS aj_name FROM limit_requests r JOIN users u ON u.id=r.aj_id WHERE r.stage='manager' AND r.status='open'").all();
    if (actor.role === 'creator' || actor.role === 'sovereign') return this.db.prepare("SELECT r.*,u.username AS aj_name FROM limit_requests r JOIN users u ON u.id=r.aj_id WHERE r.stage='top' AND r.status='open'").all();
    return [];
  }

  // ---------- 参加費(時間制)・手数料の保管 ----------
  // 参加費: プレイするたびにポケットから引く。1日(日本時間の0時区切り)の中で、1回目と2回目は1,000、3回目からは500。1回で1時間。
  // 手数料: 毎ゲーム、場の0.5%(切り上げ)。どちらも卓ごとの保管(f:卓ID)に入り、作成者・統括責任者が「受け取る」と共有ポケットに移る。
  dayKey(now) { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
  passRow(userId, now) {
    let p = this.db.prepare('SELECT * FROM passes WHERE user_id=?').get(userId) || { user_id: userId, day: this.dayKey(now), n: 0, paid_until: 0, warned_for: 0, blocked: 0 };
    if (p.day !== this.dayKey(now)) p = Object.assign({}, p, { day: this.dayKey(now), n: 0 });
    return p;
  }
  entryFeeNow(userId, now) { const p = this.passRow(userId, now); return p.n < 2 ? this.cfg.ENTRY_FEE_FIRST : this.cfg.ENTRY_FEE_NEXT; }
  passCovered(userId, now) { return this.passRow(userId, now).paid_until > now; }
  // いま払う必要がある額(払い済みの時間内なら0)
  entryDue(userId, now) { const u = this.user(userId); if (!u || u.role === 'creator' || u.role === 'sovereign') return 0; return this.passCovered(userId, now) ? 0 : this.entryFeeNow(userId, now); }
  savePass(p) { this.db.prepare('INSERT INTO passes(user_id,day,n,paid_until,warned_for,blocked) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET day=excluded.day,n=excluded.n,paid_until=excluded.paid_until,warned_for=excluded.warned_for,blocked=excluded.blocked').run(p.user_id, p.day, p.n, p.paid_until, p.warned_for, p.blocked); }
  // 参加費を引く(足りなければ引かずに false)。tableId = いま座っている卓
  chargeEntry(userId, tableId, now, continuous) {
    const p = this.passRow(userId, now), amt = p.n < 2 ? this.cfg.ENTRY_FEE_FIRST : this.cfg.ENTRY_FEE_NEXT;
    if (this.pocket(userId) < amt) return false;
    const before = this.L.balance('f:' + tableId);
    this.D.tx(() => {
      this.L.transfer(this.acct(userId), 'f:' + tableId, amt, 'entry_fee', { ref: 'table' + tableId, note: `${p.n + 1}回目` });
      const base = continuous && p.paid_until > 0 && now - p.paid_until <= 5 * 60000 ? p.paid_until : now;   // 5分以上たっていたら(サーバー停止など)、過ぎた時間ぶんをまとめて請求しない   // 途切れなく座り続けている人は、前の時間の終わりから次の1時間
      this.savePass(Object.assign({}, p, { n: p.n + 1, paid_until: base + 3600000, blocked: 0 }));
      this.db.prepare('INSERT INTO fee_log(table_id,user_id,kind,amount,ts,note) VALUES(?,?,?,?,?,?)').run(tableId, userId, 'entry', amt, now, `${p.n + 1}回目`);
    });
    this.feeNotice(tableId, before);
    return amt;
  }
  addRake(tableId, amount, note, now) {   // 台帳への移動は卓側(persist)で済んでいる。記録と通知だけ。
    this.db.prepare('INSERT INTO fee_log(table_id,user_id,kind,amount,ts,note) VALUES(?,?,?,?,?,?)').run(tableId, null, 'rake', amount, now || Date.now(), note || '');
    this.feeNotice(tableId, this.L.balance('f:' + tableId) - amount);
  }
  feeNotice(tableId, before) {   // 保管が5,000チップの区切りをこえたら、受け取りの通知
    const after = this.L.balance('f:' + tableId), step = this.cfg.FEE_NOTICE_STEP;
    if (Math.floor(after / step) > Math.floor(before / step)) this.notifyRole(['creator', 'sovereign'], 'fee_ready', { table: tableId, balance: after });
  }
  feeReceive(actor, tableId) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '作成者か統括責任者だけが受け取れます', 403);
    const amt = this.L.balance('f:' + tableId); need(amt > 0, '受け取るチップはありません');
    this.D.tx(() => {
      this.L.transfer('f:' + tableId, this.acct(actor.id), amt, 'fee_receive', { actor: actor.id, ref: 'table' + tableId });
      this.db.prepare('INSERT INTO fee_log(table_id,user_id,kind,amount,ts,note) VALUES(?,?,?,?,?,?)').run(tableId, actor.id, 'receive', amt, Date.now(), actor.username + 'が受け取り');
      this.D.audit(actor.id, 'fee_receive', tableId, { amount: amt });
    });
    return { received: amt, balance: this.pocket(actor.id) };
  }
  // 卓ごとの保管と、時系列の記録(作成者・統括責任者だけ)
  feeOverview(actor) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '見られる権限がありません', 403);
    const rows = this.db.prepare('SELECT DISTINCT table_id FROM fee_log ORDER BY table_id DESC').all();
    return rows.map(r => {
      const t = this.db.prepare('SELECT name,house_id,status FROM tables_ WHERE id=?').get(r.table_id) || {};
      const sum = k => this.db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM fee_log WHERE table_id=? AND kind=?').get(r.table_id, k).s;
      const log = this.db.prepare('SELECT f.kind,f.amount,f.ts,f.note,u.username FROM fee_log f LEFT JOIN users u ON u.id=f.user_id WHERE f.table_id=? ORDER BY f.id DESC LIMIT 100').all(r.table_id);
      return { table_id: r.table_id, name: t.name || ('卓' + r.table_id), status: t.status, balance: this.L.balance('f:' + r.table_id), entry_total: sum('entry'), rake_total: sum('rake'), received_total: sum('receive'), log };
    });
  }

  // ---------- 設定(作成者・統括責任者がアプリ内から変えられる値) ----------
  // 変更できるのは「システム更新中」のあいだだけ(動いている卓の途中でルールが変わらないように)。変更は履歴に残る。
  configDefs() {
    return [
      { key: 'feeBp', label: '手数料のうち運営の取り分', unit: '1万分の(100=1%)', min: 0, max: 500, note: '勝者が決まったゲームで、場のチップからこの割合を引き、卓ごとの保管へ(切り上げ)' },
      { key: 'jackpotBp', label: '手数料のうちジャックポットの積立', unit: '1万分の(200=2%)', min: 0, max: 1000, note: '場のチップから引いたこの割合を積み立てる。手数料の大半(既定は3%のうち2%)はプレイヤーに戻る。0にすると、ジャックポットなし' },
      { key: 'jpRank', label: 'ジャックポットが当たるソロ', unit: '数字(10=10ソロだけ)', min: 1, max: 10, note: 'この数字以上のソロで積立をもらえる。下げると当たりやすくなるが、全員降りで勝った時にも手札を見せることになる' },
      { key: 'jpLast', label: '終了時のラストゲーム', unit: '1=行う / 0=行わず分配', min: 0, max: 1, note: '時間終了・条件終了の時に、積立だけを賭けた最後の勝負をする。0なら積み上げ分に応じて分ける' },
      { key: 'shugiMin', label: '祝儀の最低倍率', unit: '倍(参加料×数字×倍率)', min: 1, max: 10, note: '祝儀をつける卓の倍率の下限。祝儀なしの卓は作れる。新しく作る・変更する卓に効く' },
      { key: 'turnSec', label: '1回の持ち時間', unit: '秒', min: 10, max: 300, note: '過ぎると自動で降りる' },
      { key: 'voteSec', label: '途中参加の投票の時間', unit: '秒', min: 10, max: 300, note: '' },
      { key: 'minStayMin', label: '着席してから退席できるまで', unit: '分', min: 0, max: 120, note: '途中退席を許す卓で、座ってからこの時間は席を立てない' },
      { key: 'disconnectSec', label: '接続が切れてから離席扱いになるまで', unit: '秒', min: 2, max: 120, note: '' },
      { key: 'entryFee', label: '参加費をとる', unit: '1=とる / 0=とらない', min: 0, max: 1, note: '時間ごとの参加費' },
      { key: 'entryFirst', label: '参加費(1日の1・2時間目)', unit: 'チップ', min: 0, max: 100000, note: '日本時間の0時で数え直し' },
      { key: 'entryNext', label: '参加費(3時間目から)', unit: 'チップ', min: 0, max: 100000, note: '' },
      { key: 'minUnit', label: '参加料・最低ベットの最低額', unit: 'チップ', min: 1, max: 100000, note: '新しく作る卓・変更する卓に効く(今ある卓の設定は変わらない)' },
      { key: 'graceMin', label: 'チップ不足の猶予', unit: '分', min: 1, max: 60, note: '流れた次の試合で足りない人に渡す時間' },
      { key: 'nuisanceLimit', label: '迷惑行為で自動退会になる回数', unit: '回', min: 1, max: 10, note: '' },
      { key: 'noticeStep', label: '受け取りの通知を出す額', unit: 'チップ', min: 1000, max: 10000000, note: '保管がこの額を超えるたびに通知' },
      { key: 'liveHands', label: '作成者・統括の観戦で、ゲーム中の手札を見る', unit: '1=見る / 0=ゲームの後だけ', min: 0, max: 1, note: '他の会社に貸す・売るときは0を推奨(運営側の人が手札を知りながら誰かに教える疑いを持たれないため)。ゲームの後のデータでは、どちらでも全員の手札を確認できます' },
      { key: 'chat', label: '卓のメッセージ機能', unit: '1=使える / 0=使えない', min: 0, max: 1, note: '' },
      { key: 'billing', label: '有料プランの申し込み', unit: '1=受け付ける / 0=受け付けない', min: 0, max: 1, note: '0にしても、すでに入っている人のプランは止まりません(解約はStripeの画面から)' },
      { key: 'pricePlayer', label: '一般プランの月額', unit: '円', min: 100, max: 10000, note: '変えた後に申し込む人から新しい金額。すでに入っている人の金額は変わりません' },
      { key: 'priceAj', label: 'AJプランの月額', unit: '円', min: 100, max: 30000, note: '変えた後に申し込む人から新しい金額。すでに入っている人の金額は変わりません' },
      { key: 'priceTheme', label: '卓のテーマの値段(買い切り)', unit: '円', min: 100, max: 5000, note: '1つあたり。有料プランの人は全部使える' },
      { key: 'planPeek', label: 'プランの更新ごとの手札確認チケット', unit: '枚(0=付けない)', min: 0, max: 30, note: 'お金で勝負の情報を買う形にならないか、弁護士の確認が済むまでは0のままを推奨' },
      { key: 'ads', label: '広告', unit: '1=出す / 0=出さない', min: 0, max: 1, note: 'ゲーム中の卓には出ません。有料プランの人と作成者・統括責任者には出ません' },
      { key: 'adNet', label: '広告会社(Google AdSense)の広告', unit: '1=使う / 0=地元スポンサーだけ', min: 0, max: 1, note: 'サーバーに ADSENSE_CLIENT(広告会社の番号)を入れたときだけ働きます。スポンサーの広告が先に出ます' },
      { key: 'adGapMin', label: '全画面の広告の間隔', unit: '分', min: 3, max: 120, note: '卓を出るときだけ出す。この時間は次を出さない' }
    ];
  }
  configValue(key) {
    const o = this.tablesOpt || {}, c = this.cfg;
    return ({ feeBp: o.feeBp, jackpotBp: o.jackpotBp, jpRank: o.jpRank, jpLast: o.jpLast ? 1 : 0, shugiMin: o.shugiMin, turnSec: Math.round((o.turnMs || 40000) / 1000), voteSec: Math.round((o.voteMs || 60000) / 1000), minStayMin: Math.round((o.minStayMs == null ? 900000 : o.minStayMs) / 60000), disconnectSec: Math.round((o.disconnectGraceMs || 8000) / 1000), entryFee: o.entryFee ? 1 : 0, entryFirst: c.ENTRY_FEE_FIRST, entryNext: c.ENTRY_FEE_NEXT, minUnit: o.minUnit, graceMin: Math.round((o.graceMs || 300000) / 60000), nuisanceLimit: c.NUISANCE_LIMIT, noticeStep: c.FEE_NOTICE_STEP, chat: o.chatEnabled ? 1 : 0, liveHands: o.liveHands === false ? 0 : 1, ads: o.ads ? 1 : 0, billing: c.BILLING ? 1 : 0, pricePlayer: c.PRICE_PLAYER, priceAj: c.PRICE_AJ, priceTheme: c.PRICE_THEME, planPeek: c.PLAN_PEEK, adNet: c.AD_NET ? 1 : 0, adGapMin: c.AD_GAP_MIN })[key];
  }
  applyConfig(patch) {
    const o = this.tablesOpt, c = this.cfg;
    if ('jackpotBp' in patch) o.jackpotBp = patch.jackpotBp; if ('jpRank' in patch) o.jpRank = patch.jpRank; if ('jpLast' in patch) o.jpLast = !!patch.jpLast; if ('shugiMin' in patch) o.shugiMin = patch.shugiMin;
    if ('turnSec' in patch) o.turnMs = patch.turnSec * 1000; if ('voteSec' in patch) o.voteMs = patch.voteSec * 1000; if ('minStayMin' in patch) o.minStayMs = patch.minStayMin * 60000; if ('disconnectSec' in patch) o.disconnectGraceMs = patch.disconnectSec * 1000;
    if ('feeBp' in patch) o.feeBp = patch.feeBp; if ('entryFee' in patch) o.entryFee = !!patch.entryFee; if ('entryFirst' in patch) c.ENTRY_FEE_FIRST = patch.entryFirst; if ('entryNext' in patch) c.ENTRY_FEE_NEXT = patch.entryNext;
    if ('minUnit' in patch) o.minUnit = patch.minUnit; if ('graceMin' in patch) o.graceMs = patch.graceMin * 60000; if ('nuisanceLimit' in patch) c.NUISANCE_LIMIT = patch.nuisanceLimit; if ('noticeStep' in patch) c.FEE_NOTICE_STEP = patch.noticeStep; if ('chat' in patch) o.chatEnabled = !!patch.chat; if ('liveHands' in patch) o.liveHands = !!patch.liveHands; if ('ads' in patch) o.ads = !!patch.ads;
    if ('billing' in patch) c.BILLING = patch.billing ? 1 : 0; if ('pricePlayer' in patch) c.PRICE_PLAYER = patch.pricePlayer; if ('priceAj' in patch) c.PRICE_AJ = patch.priceAj;
    if ('priceTheme' in patch) c.PRICE_THEME = patch.priceTheme; if ('planPeek' in patch) c.PLAN_PEEK = patch.planPeek; if ('adNet' in patch) c.AD_NET = patch.adNet ? 1 : 0; if ('adGapMin' in patch) c.AD_GAP_MIN = patch.adGapMin;
  }
  loadConfig() { const r = this.db.prepare("SELECT v FROM meta WHERE k='config'").get(); if (r) { try { this.applyConfig(JSON.parse(r.v)); } catch (e) {} } }
  getConfig(actor) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403);
    const lg = this.db.prepare("SELECT v FROM meta WHERE k='config_log'").get();
    const G = { feeBp: '手数料とジャックポット', jackpotBp: '手数料とジャックポット', jpRank: '手数料とジャックポット', jpLast: '手数料とジャックポット', shugiMin: '祝儀', entryFee: '参加費', entryFirst: '参加費', entryNext: '参加費', noticeStep: '参加費', turnSec: '卓の進行', voteSec: '卓の進行', graceMin: '卓の進行', minStayMin: '卓の進行', disconnectSec: '卓の進行', minUnit: '卓の作り方', nuisanceLimit: 'その他', chat: 'その他', liveHands: 'その他', ads: '広告', adNet: '広告', adGapMin: '広告', billing: '有料プラン', priceTheme: '有料プラン', planPeek: '有料プラン', pricePlayer: '有料プラン', priceAj: '有料プラン' };
    const ORDER = ['手数料とジャックポット', '祝儀', '参加費', '卓の進行', '卓の作り方', '有料プラン', '広告', 'その他'];
    const items = this.configDefs().map(d => Object.assign({}, d, { group: G[d.key] || 'その他', value: this.configValue(d.key) })).sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
    return { items, log: lg ? JSON.parse(lg.v) : [], maintenance: this.maintenance().on };
  }
  setConfig(actor, patch) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403);
    need(this.maintenance().on, '設定を変えるには、先に「システム更新中」にしてください(動いている卓の途中でルールが変わらないようにするためです)');
    const defs = Object.fromEntries(this.configDefs().map(d => [d.key, d])), clean = {}, changes = [];
    for (const [k, v] of Object.entries(patch || {})) {
      const d = defs[k]; need(d, '知らない設定です: ' + k); const n = Number(v);
      need(Number.isInteger(n) && n >= d.min && n <= d.max, `${d.label}は ${d.min}〜${d.max} の整数にしてください`);
      if (n !== this.configValue(k)) { clean[k] = n; changes.push({ key: k, label: d.label, from: this.configValue(k), to: n }); }
    }
    need(changes.length, '変更がありません');
    { const f = k => (k in clean ? clean[k] : this.configValue(k)); need(f('feeBp') + f('jackpotBp') <= 1000, '運営の取り分とジャックポットの積立の合計は、10%(1000)までにしてください'); }
    const cur = this.db.prepare("SELECT v FROM meta WHERE k='config'").get(); const merged = Object.assign(cur ? JSON.parse(cur.v) : {}, clean);
    const lg = this.db.prepare("SELECT v FROM meta WHERE k='config_log'").get(); const log = lg ? JSON.parse(lg.v) : [];
    log.unshift({ ts: Date.now(), by: actor.username, changes }); log.length = Math.min(log.length, 100);
    this.D.tx(() => {
      this.db.prepare("INSERT INTO meta(k,v) VALUES('config',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(merged));
      this.db.prepare("INSERT INTO meta(k,v) VALUES('config_log',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(log));
      this.D.audit(actor.id, 'config', 0, { changes });
    });
    this.applyConfig(clean); return { changes };
  }
  // 「ここをこう変えたい」という要望の控え(作成者・統括責任者)
  listRequests(actor) { need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403); return this.db.prepare('SELECT r.id,r.body,r.status,r.ts,u.username,COALESCE(json_array_length(r.images),0) AS nimg FROM change_requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 200').all(); }
  // 写真は3枚まで。画面で小さくした JPEG などの data URL(1枚 約300KBまで)。SVG は中に命令を書けるので受け付けない
  addRequest(actor, body, images) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403);
    body = String(body || '').trim().slice(0, 1000); images = Array.isArray(images) ? images : [];
    need(images.length <= 3, '写真は3枚までです');
    need(images.every(s => typeof s === 'string' && s.length <= 400000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)), '写真は PNG・JPEG・WebP で、1枚 約300KBまでにしてください');
    need(body || images.length, '内容を入力するか、写真を付けてください');
    return Number(this.db.prepare('INSERT INTO change_requests(user_id,body,images,ts) VALUES(?,?,?,?)').run(actor.id, body, images.length ? JSON.stringify(images) : null, Date.now()).lastInsertRowid);
  }
  requestImages(actor, id) { need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403); const r = this.db.prepare('SELECT images FROM change_requests WHERE id=?').get(Number(id)); need(r, '見つかりません', 404); return { images: r.images ? JSON.parse(r.images) : [] }; }
  setRequestStatus(actor, id, status) { need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403); need(['未', '対応中', '済', 'なし'].includes(status), '状態が正しくありません'); this.db.prepare('UPDATE change_requests SET status=? WHERE id=?').run(status, Number(id)); }

  // ---------- システム更新中(メンテナンス) ----------
  maintenance() { const r = this.db.prepare("SELECT v FROM meta WHERE k='maintenance'").get(); try { return r ? JSON.parse(r.v) : { on: false }; } catch (e) { return { on: false }; } }
  setMaintenance(actor, on, msg, at) {
    need(!actor || actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403);
    at = Math.floor(Number(at) || 0); need(!at || at > Date.now(), '予告の時刻が過ぎています');
    const v = { on: !!on, msg: String(msg || '').slice(0, 100), ts: Date.now(), at: on ? 0 : at };   // at = 予告(その時刻に自動で更新中になる)
    this.db.prepare("INSERT INTO meta(k,v) VALUES('maintenance',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(v));
    this.D.audit(actor ? actor.id : null, 'maintenance', 0, v); return v;
  }

  // ---------- 不正対策 ----------
  suspect(userId, kind, detail) {
    const who = this.user(userId); if (who && STAFF.includes(who.role)) return;   // 作成者・統括責任者・ゲーム管理責任者は1人ずつで、複数の端末(iPhone・iPad・Mac)を使うのが前提のため、疑いに数えない
    this.db.prepare('INSERT INTO suspicion(user_id,kind,detail,ts) VALUES(?,?,?,?)').run(userId, kind, JSON.stringify(detail || {}), Date.now());
    const since = Date.now() - 30 * 24 * 3600 * 1000;
    const n = this.db.prepare('SELECT COUNT(*) AS c FROM suspicion WHERE user_id=? AND ts>?').get(userId, since).c;
    if (n >= this.cfg.SUSPICION_THRESHOLD && n % this.cfg.SUSPICION_THRESHOLD === 0) {
      const u = this.user(userId);
      this.notifyRole(['manager', 'creator', 'sovereign'], 'check', { user: u.username, user_id: userId, count: n, last: kind });
    }
  }
  report(actor, targetId, tableId, reason) {
    const t = this.user(targetId); need(t && t.id !== actor.id, '通報の対象が不正です');
    const day = Date.now() - 24 * 3600 * 1000;
    need(!this.db.prepare('SELECT 1 FROM reports WHERE reporter_id=? AND target_id=? AND ts>?').get(actor.id, t.id, day), '同じ相手への通報は1日1回までです');
    this.db.prepare('INSERT INTO reports(reporter_id,target_id,table_id,reason,ts) VALUES(?,?,?,?,?)').run(actor.id, t.id, tableId || null, String(reason || '').slice(0, 300), Date.now());
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    const n = this.db.prepare('SELECT COUNT(DISTINCT reporter_id) AS c FROM reports WHERE target_id=? AND ts>?').get(t.id, week).c;
    if (n >= this.cfg.REPORT_THRESHOLD && t.status === 'active' && t.role === 'player') {
      this.db.prepare("UPDATE users SET status='watch',status_note=? WHERE id=?").run('通報' + n + '人', t.id);
      this.notifyRole(['creator', 'sovereign'], 'watch', { user: t.username, user_id: t.id, reporters: n });
      this.D.audit(null, 'watch', t.id, { reporters: n });
    }
    return { reported: true };
  }
  adminReports(actor) {
    need(actor.role === 'creator' || actor.role === 'sovereign' || actor.role === 'manager', '権限がありません', 403);
    const rows = this.db.prepare(`SELECT t.id,t.username,t.status,t.status_note,COUNT(DISTINCT r.reporter_id) AS reporters,COUNT(*) AS reports,MAX(r.ts) AS last_ts
      FROM reports r JOIN users t ON t.id=r.target_id GROUP BY t.id ORDER BY last_ts DESC`).all();
    return rows;
  }
  watchList(actor) { need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403); return this.db.prepare("SELECT id,username,status,status_note FROM users WHERE status='watch'").all(); }
  clearWatch(actor, userId) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '作成者か統括責任者だけが決められます', 403);
    this.db.prepare("UPDATE users SET status='active',status_note=NULL WHERE id=? AND status='watch'").run(userId);
    this.D.audit(actor.id, 'clear_watch', userId);
  }
  expel(actor, userId, reason) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '作成者か統括責任者だけが退会させられます', 403);
    const u = this.user(userId); need(u && ROLES[u.role] > ROLES[actor.role] || (u && actor.role === 'creator' && u.role === 'sovereign'), '対象が不正です', 403);
    need(u.role !== 'creator', '作成者は退会させられません', 403);
    this._expel(actor, u, reason);
  }
  // 迷惑行為(流れた次の試合に、猶予を使っても戻ってこない)の記録。3回目で自動的に退会。
  nuisance(userId, kind, detail) {
    const u = this.user(userId); if (!u) return { count: 0 };
    this.db.prepare('INSERT INTO suspicion(user_id,kind,detail,ts) VALUES(?,?,?,?)').run(u.id, 'nuisance:' + kind, JSON.stringify(detail || {}), Date.now());
    const count = this.db.prepare("SELECT COUNT(*) AS c FROM suspicion WHERE user_id=? AND kind LIKE 'nuisance:%'").get(u.id).c;
    this.notifyRole(['creator', 'sovereign'], 'nuisance', { user: u.username, user_id: u.id, count, kind });
    this.D.audit(null, 'nuisance', u.id, { kind, count });
    if (count >= this.cfg.NUISANCE_LIMIT && u.role === 'player' && u.status !== 'banned') {
      const creator = this.db.prepare("SELECT * FROM users WHERE role='creator'").get();
      this._expel(creator, u, `迷惑行為${count}回(自動退会)`);
      return { count, expelled: true };
    }
    return { count, expelled: false };
  }
  _expel(actor, u, reason) {
    if (this.onUserBanned) this.onUserBanned(u.id);      // 卓から外してチップをポケットへ戻す
    this.D.tx(() => {
      this.db.prepare("UPDATE users SET status='banned',status_note=? WHERE id=?").run(String(reason || '').slice(0, 200), u.id);
      for (const s of this.db.prepare('SELECT ip FROM sessions WHERE user_id=?').all(u.id)) if (s.ip) this.db.prepare('INSERT OR IGNORE INTO banned_ips(ip,user_id,ts) VALUES(?,?,?)').run(s.ip, u.id, Date.now());
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      for (const d of this.db.prepare('SELECT DISTINCT ip FROM devices WHERE user_id=? AND ip!=\'\'').all(u.id)) this.db.prepare('INSERT OR IGNORE INTO banned_ips(ip,user_id,ts) VALUES(?,?,?)').run(d.ip, u.id, Date.now());
      // 残りのチップは上位(直の上位者。いなければ作成者)に戻す。総量は変わらない。
      const bal = this.pocket(u.id);
      if (bal > 0) {
        let to = u.parent_id && this.user(u.parent_id); if (!to || to.status === 'banned') to = this.db.prepare("SELECT * FROM users WHERE role='creator'").get();
        this.L.transfer(this.acct(u.id), this.acct(to.id), bal, 'expel_return', { actor: actor.id, note: '退会による返還' });
      }
      this.D.audit(actor.id, 'expel', u.id, { reason });
    });
  }
  permitIp(actor, ip, username) {
    need(actor.role === 'creator' || actor.role === 'sovereign', '作成者か統括責任者だけが許可できます', 403);
    need(ip && username, 'IPとユーザー名が必要です');
    this.db.prepare('INSERT OR IGNORE INTO ip_permits(ip,username,granted_by,ts) VALUES(?,?,?,?)').run(ip, username, actor.id, Date.now());
    this.D.audit(actor.id, 'ip_permit', username, { ip });
  }
  bannedIps(actor) { need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403); return this.db.prepare('SELECT b.ip,b.ts,u.username FROM banned_ips b LEFT JOIN users u ON u.id=b.user_id').all(); }
  // 同じ端末・同じIPのアカウント一覧(管理責任者以上)
  // ---- 手札確認チケット(全員降りで勝負にならなかったゲームの終了後に、勝者の手札を見る券) ----
  peekBalance(uid) { const r = this.db.prepare('SELECT n FROM peek_tickets WHERE user_id=?').get(uid); return r ? r.n : 0; }
  // 付与: 決済やサブスクがつながるまでは、作成者・統括責任者の手で付ける(本番の決済からも、同じこのメソッドを呼ぶ)
  peekGrant(actor, userId, n, kind, ref) {
    need(actor && ['creator', 'sovereign'].includes(actor.role), '権限がありません', 403);
    return this.peekAdd(userId, n, kind || 'grant', ref || ('by:' + actor.id));
  }
  peekAdd(userId, n, kind, ref) {
    n = Math.floor(Number(n)); need(Number.isInteger(n) && n >= 1 && n <= 1000, '枚数は1〜1000で入れてください');
    need(this.user(userId), '利用者が見つかりません', 404);
    this.db.prepare('INSERT INTO peek_tickets(user_id,n) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET n=n+excluded.n').run(userId, n);
    this.db.prepare('INSERT INTO peek_log(user_id,delta,kind,ref,ts) VALUES(?,?,?,?,?)').run(userId, n, kind, ref || null, Date.now());
    return this.peekBalance(userId);
  }
  peekSpend(userId, ref) {
    const r = this.db.prepare('UPDATE peek_tickets SET n=n-1 WHERE user_id=? AND n>=1').run(userId);
    need(r.changes === 1, '手札確認チケットがありません');
    this.db.prepare('INSERT INTO peek_log(user_id,delta,kind,ref,ts) VALUES(?,?,?,?,?)').run(userId, -1, 'use', ref || null, Date.now());
  }

  sharedDevices(actor) {
    need(['creator', 'sovereign', 'manager'].includes(actor.role), '権限がありません', 403);
    const byDev = this.db.prepare(`SELECT d.device_id AS key,'端末' AS type,GROUP_CONCAT(DISTINCT u.username) AS users,COUNT(DISTINCT u.id) AS n FROM devices d JOIN users u ON u.id=d.user_id WHERE u.role NOT IN ('creator','sovereign','manager') GROUP BY d.device_id HAVING n>1`).all();
    const byIp = this.db.prepare(`SELECT d.ip AS key,'IP' AS type,GROUP_CONCAT(DISTINCT u.username) AS users,COUNT(DISTINCT u.id) AS n FROM devices d JOIN users u ON u.id=d.user_id WHERE d.ip!='' AND u.role NOT IN ('creator','sovereign','manager') GROUP BY d.ip HAVING n>1`).all();
    return byDev.map(r => Object.assign(r, { key: r.key.slice(0, 6) + '…' })).concat(byIp);
  }
  notifications(actor) { return this.db.prepare('SELECT id,kind,body,ts,read FROM notifications WHERE to_user=? ORDER BY id DESC LIMIT 100').all(actor.id).map(n => Object.assign(n, { body: JSON.parse(n.body) })); }
  markRead(actor) { this.db.prepare('UPDATE notifications SET read=1 WHERE to_user=?').run(actor.id); }
  auditLog(actor, limit) { need(actor.role === 'creator' || actor.role === 'sovereign', '権限がありません', 403); return this.db.prepare('SELECT a.*,u.username AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ?').all(limit || 200); }
}
module.exports = { Core, Err, need, CFG };
