'use strict';
const Solo = require('../engine.js');
const { Err, need } = require('./core');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEFAULTS = {
  seats: 6, ante: 100, minBet: 100, limit: 1000, limitType: 'perBet', maxBets: 3, reserve: 10,
  upEnabled: true,
  upLimit: null, upLimitType: null,   // ビキのアップの上限(未指定なら親のベット上限と同じ)
  gameMaxBets: 0, gameMaxUps: 0, upResetOnOya: true,      // 1ゲーム全体でのベット回数・アップ回数の上限(0=つけない)
  startMode: 'free',        // free=自由 / condition=条件開始
  chips: 20000,             // 条件開始: 全員このチップで開始
  minPlayers: 4,            // 条件開始: この人数がそろったら開始
  durationMin: 0,           // 0=時間で終わらない
  endZero: 0,               // 0=なし / N=N人がゲームに出られなくなったら終了
  lateJoin: 'allow',        // allow / deny / vote
  leave: 'deny',            // allow / deny
  chat: true,
  shugiMul: 1,              // 祝儀 = 参加料 × ソロの数字 × この倍率(0=祝儀なし)
};
function normSettings(raw, prev, minUnit, shugiMin) {
  minUnit = Math.max(1, Math.floor(Number(minUnit) || 1));   // アプリ全体の最小単位(参加料・最低ベットはこれ以上)
  const s = Object.assign({}, DEFAULTS, prev || {}, raw || {});
  const int = (v, lo, hi, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  s.seats = int(s.seats, 2, 8, 6); s.ante = int(s.ante, minUnit, 100000, Math.max(minUnit, 100)); s.minBet = int(s.minBet, minUnit, 100000, Math.max(minUnit, 100));
  s.limit = int(s.limit, s.minBet, 1000000, Math.max(s.minBet, 1000)); s.maxBets = int(s.maxBets, 1, 5, 3); s.reserve = int(s.reserve, 0, 100000, 10);
  s.limitType = s.limitType === 'perGame' ? 'perGame' : 'perBet';
  s.upLimit = s.upLimit == null || s.upLimit === '' ? null : int(s.upLimit, s.minBet, 1000000, s.limit);
  s.upLimitType = s.upLimitType === 'perGame' ? 'perGame' : s.upLimitType === 'perBet' ? 'perBet' : null;
  s.upResetOnOya = !(s.upResetOnOya === false || s.upResetOnOya === 0 || s.upResetOnOya === '0'); s.gameMaxBets = int(s.gameMaxBets, 0, 50, 0); s.gameMaxUps = int(s.gameMaxUps, 0, 50, 0);
  s.upEnabled = !(s.upEnabled === false || s.upEnabled === 'off' || s.upEnabled === 'false');
  s.startMode = s.startMode === 'condition' ? 'condition' : 'free';
  s.chips = int(s.chips, s.ante + s.reserve + Math.max(s.limit, s.upLimit || 0), 100000000, 20000);
  s.minPlayers = int(s.minPlayers, 2, s.seats, Math.min(4, s.seats));
  s.durationMin = int(s.durationMin, 0, 24 * 60, 0); s.endZero = int(s.endZero, 0, s.seats, 0);
  s.lateJoin = ['allow', 'deny', 'vote'].includes(s.lateJoin) ? s.lateJoin : 'deny';
  s.leave = s.leave === 'allow' ? 'allow' : 'deny';
  if (s.startMode === 'condition') s.leave = 'deny';   // 条件開始の卓は途中退席できない
  s.chat = s.chat !== false && s.chat !== 'false';
  // 祝儀: 0=なし。つけるなら、アプリ全体の最低倍率(shugiMin)以上。最大額ぶんは必ず手元に残す
  shugiMin = Math.max(1, Math.floor(Number(shugiMin) || 1));
  s.shugiMul = int(s.shugiMul, 0, 10, 1); if (s.shugiMul > 0) s.shugiMul = Math.max(shugiMin, s.shugiMul);
  if (s.shugiMul > 0) s.reserve = Math.max(s.reserve, Math.min(10000000, s.ante * 10 * s.shugiMul));
  s.chips = int(s.chips, s.ante + s.reserve + Math.max(s.limit, s.upLimit || 0), 100000000, 20000);
  return s;
}

class Runtime {
  constructor(M, row) {
    this.M = M; this.core = M.core; this.D = M.core.D; this.L = M.core.L;
    this.id = row.id; this.houseId = row.house_id; this.name = row.name; this.s = JSON.parse(row.settings);
    this.status = row.status; this.startedAt = row.started_at || null;
    this.seats = Array.from({ length: this.s.seats }, () => null);
    this.T = null; this.pending = null; this.shortPend = new Map(); this.subs = new Map(); this.log = []; this.chat = [];
    this.vote = null; this.stopReq = false; this.loopOn = false; this.gameNo = 0; this.lastGame = null; this.peeked = {}; this.peekPool = {};
    this.pairLoss = {}; this.fastCount = {}; this.revealed = [];
    this.buildEngine();
  }
  buildEngine() {
    const s = this.s;
    const T = Solo.createTable({ seats: s.seats, ante: s.ante, minBet: s.minBet, limit: s.limit, limitType: s.limitType, maxBets: s.maxBets, reserve: s.reserve, upEnabled: s.upEnabled, upLimit: s.upLimit, upLimitType: s.upLimitType, gameMaxBets: s.gameMaxBets, gameMaxUps: s.gameMaxUps, upResetOnOya: s.upResetOnOya, shugiMul: s.shugiMul, jpRank: this.M.opt.jpRank, minUnit: this.M.opt.minUnit, startPts: s.ante + s.reserve + s.limit }, { feeBp: this.M.opt.feeBp, jpBp: this.M.opt.jackpotBp, humans: Array.from({ length: s.seats }, (_, i) => i) });
    T.players.forEach(p => { p.pts = 0; p.vacant = true; p.name = ''; p.cpu = null; });
    this.T = T;
  }
  acct(uid) { return 's:' + this.id + ':' + uid; }
  potAcct() { return 'p:' + this.id; }
  jpAcct() { return 'j:' + this.id; }
  seatOf(uid) { return this.seats.findIndex(x => x && x.userId === uid); }
  count() { return this.seats.filter(Boolean).length; }
  addLog(m, k) { this.log.push({ t: Date.now(), m, k: k || '' }); if (this.log.length > 80) this.log.shift(); }
  connected(i) { const st = this.seats[i]; return !!(st && (this.subs.get(st.userId) || new Set()).size > 0); }
  canPlay(i) { const p = this.T.players[i]; return !p.vacant && !p.sitout && p.pts >= this.s.ante + this.s.reserve; }
  now() { return this.M.opt.clock(); }

  // ---- 通信(SSE) ----
  subscribe(user, res) {
    const set = this.subs.get(user.id) || new Set(); set.add(res); this.subs.set(user.id, set);
    const i = this.seatOf(user.id);
    if (i >= 0 && this.seats[i].away && !this.seats[i].manualAway) { this.seats[i].away = false; this.addLog(`${user.username}が戻りました`, 'info'); this.feeTick(); }
    this.broadcast();
  }
  unsubscribe(user, res) {
    const set = this.subs.get(user.id); if (set) { set.delete(res); if (!set.size) this.subs.delete(user.id); }
    const i = this.seatOf(user.id);
    if (i >= 0 && !this.subs.get(user.id)) {
      setTimeout(() => { // 少し待っても戻らなければ離席扱い。順番が来ていれば自動で降りる
        const j = this.seatOf(user.id);
        if (j >= 0 && !this.subs.get(user.id)) { this.seats[j].away = true; this.addLog(`${user.username}は接続が切れたため離席扱いです`, 'info'); this.autoFoldPending(j); this.broadcast(); }
      }, this.M.opt.disconnectGraceMs);
    }
    this.broadcast();
  }
  autoFoldPending(i) { if (this.pending && this.pending.req.seat === i && !this.pending.req.short) this.resolvePending(this.pending.req.type === 'carryJoin' ? { act: 'skip' } : { act: 'fold' }, true); }
  broadcast() {
    this.beat = Date.now();   // 最後に動いた時刻(止まった卓を見つけるため)
    for (const [uid, set] of this.subs) {
      if (!set.size) continue;
      const data = 'data: ' + JSON.stringify(this.view(uid)) + '\n\n';
      for (const res of set) { try { res.write(data); } catch (e) { /* 切断 */ } }
    }
  }

  // ---- 画面に渡す情報(手札は本人だけ。他人のチップは渡さない) ----
  view(uid) {
    const T = this.T, g = T.g, i = this.seatOf(uid), u = this.core.user(uid);
    const spectator = i < 0 && u && (u.role === 'creator' || u.role === 'sovereign');
    const detail = i >= 0 || !!spectator;   // 着席していない人(観戦)には、チップの数や結果の細かい数字、積立を見せない
    const live = g && g.phase !== 'done' ? g : (g || null);
    let bikiSeat = null;
    if (live && this.s.upEnabled && g.phase !== 'done') { const r = Solo.ring(T, g); if (r.length >= 2) bikiSeat = r[r.length - 1]; }
    const showHands = g && (g.phase === 'showdown' || g.phase === 'done') && g.result && (g.result.how === 'show' || g.result.how === 'jackpot') || (g && g.phase === 'showdown') || !!(g && g.result && g.result.jp && g.result.jp.reveal);
    const handOf = s => {
      if (!g || !g.hands[s]) return null;
      if (s === i || spectator) return g.hands[s];
      if (showHands && g.revealed.includes(s)) return g.hands[s];
      return null;
    };
    const seats = this.seats.map((st, s) => {
      if (!st) return { i: s, empty: true };
      const p = T.players[s];
      return { i: s, name: st.username, net: detail ? (this.netMap()[st.username] || 0) : null, chips: detail ? p.pts : null, away: !!st.away, rest: !!p.sitout, you: s === i,
        oya: !!(g && g.phase !== 'done' && g.oya === s), biki: bikiSeat === s,
        active: g ? g.active.has(s) : false, inGame: g ? g.parts.includes(s) : false,
        say: g && g.say ? (g.say[s] || '') : '', acting: !!(g && g.acting === s),
        hand: handOf(s) ? handOf(s).map(c => c.n + c.s) : null, hasCards: !!(g && g.hands[s] && g.parts.includes(s) && g.active.has(s)) };
    });
    const mine = i >= 0 && g && g.hands[i] ? { hand: g.hands[i].map(c => c.n + c.s), label: g.ev[i] ? g.ev[i].label : null } : null;
    const pp = this.pending && this.pending.req.seat === i ? this.pending : this.shortPend.get(i);
    const req = pp ? Object.assign({}, pp.req, { deadline: pp.deadline }) : null;
    const v = this.vote && !this.vote.done ? { id: this.vote.id, who: this.vote.username, chips: this.vote.chips, yes: this.vote.yes.size, no: this.vote.no.size, need: Math.floor(this.count() / 2) + 1, mine: this.vote.yes.has(uid) ? 'yes' : this.vote.no.has(uid) ? 'no' : null, expires: this.vote.expires } : null;
    return {
      id: this.id, name: this.name, status: this.status, settings: this.s, houseId: this.houseId,
      you: i >= 0 ? { seat: i, fee: this.feeInfo(uid), pocket: this.core.pocket(uid), canLeave: this.leaveCheck(uid).ok, leaveWhy: this.leaveCheck(uid).why, away: !!this.seats[i].away, queuedLeave: !!this.seats[i].leaveQueued } : { seat: -1, pocket: this.core.pocket(uid), spectator },
      seats, pot: T.pot, carry: T.carry ? { fee: T.carry.fee } : null, color: T.color, gameNo: T.gameNo,
      phase: g ? g.phase : 'wait', commit: g && g.commit ? g.commit.hash : null, round: g ? g.round : 0, actType: g && g.acting != null ? g.actType : null, curBet: g && g.phase !== 'done' ? g.curBet : 0, curUp: g && g.phase !== 'done' ? g.curUp : 0, deckN: g ? 20 : 20, dealOrder: g && g.commit ? g.commit.order : null, nParts: g ? g.parts.length : 0,
      peek: this.peekView(uid, i),
      jp: i >= 0 ? this.jpView(i) : (u && ['creator', 'sovereign', 'manager'].includes(u.role) ? this.jpView(-1) : { on: false }), rules: { feeBp: this.M.opt.feeBp, jpBp: this.M.opt.jackpotBp, shugiMul: this.s.shugiMul },
      mine, req, log: detail ? this.log.slice(-40) : [], watch: !detail, chat: this.chat.slice(-60), vote: v,
      startedAt: this.startedAt, endsAt: this.s.durationMin && this.startedAt ? this.startedAt + this.s.durationMin * 60000 : null,
      result: detail || !this.lastGame ? this.lastGame : { no: this.lastGame.no, how: this.lastGame.how, winner: this.lastGame.winner, hash: this.lastGame.hash, hands: this.lastGame.hands }, serverTime: Date.now()
    };
  }

  // ---- 手札確認チケット: 全員降りで勝負にならなかったゲームの終了後、次のゲームが始まる前だけ、勝者の手札を見られる ----
  peekOpen() {   // 見られる状態か(まだ公開されていない勝者の手札が、直前のゲームにあるか)
    const L = this.lastGame, g = this.T.g;
    return !!(L && L.how === 'fold' && !L.hands && g && g.no === L.no && g.phase === 'done' && L.winner);
  }
  peekView(uid, i) {
    if (i < 0 || !this.peekOpen()) return null;
    const mine = this.seats[i] ? this.seats[i].username : null, seen = this.peeked[uid] || {};
    const targets = Object.keys(this.peekPool || {}).filter(n => n !== mine).map(n => ({ name: n, winner: n === this.lastGame.winner, hand: seen[n] || null }));
    return { no: this.lastGame.no, count: this.core.peekBalance(uid), targets };
  }
  peek(user, target) {
    const i = this.seatOf(user.id); need(i >= 0, '着席していません');
    need(this.peekOpen(), 'いま見られる手札はありません(全員が降りたゲームの終了後、次のゲームが始まる前だけです)');
    const me = this.seats[i].username; target = String(target || '');
    need(target !== me, '自分の手札は、もう見えています');
    const pool = this.peekPool || {}; need(pool[target], 'その人の手札は見られません');
    const seen = this.peeked[user.id] = this.peeked[user.id] || {};
    need(!seen[target], 'この人の手札は、すでに見ています');
    this.core.peekSpend(user.id, 'table' + this.id + ':g' + this.T.g.no + ':' + target);   // チケットを1枚使う(足りなければここで止まる)
    seen[target] = pool[target];
    this.broadcast();
    return { name: target, hand: pool[target], winner: target === this.lastGame.winner, left: this.core.peekBalance(user.id) };
  }

  jpView(i) {
    const T = this.T, pool = T.jp.pool, on = this.M.opt.jackpotBp > 0 || pool > 0;
    return { on, pool, mine: i >= 0 ? (T.jp.ent[i] || 0) : 0, rank: T.cfg.jpRank, last: !!(T.g && T.g.last) };
  }
  jpEntByUser() { const o = {}; this.seats.forEach((st, i) => { if (st && this.T.jp.ent[i]) o[st.userId] = this.T.jp.ent[i]; }); return o; }

  feeInfo(uid) {
    if (!this.M.opt.entryFee) return null; const now = this.now(), c = this.core, u = c.user(uid);
    if (!u || u.role === 'creator' || u.role === 'sovereign') return { exempt: true };
    const p = c.passRow(uid, now); return { until: p.paid_until > now ? p.paid_until : 0, next: c.entryFeeNow(uid, now), count: p.n, blocked: !!(this.seats[this.seatOf(uid)] || {}).blocked };
  }

  // ---- 着席・退席 ----
  joinCheck(user) {
    need(['open', 'running'].includes(this.status), 'この卓は終了しています');
    need(this.core.isMember(user.id, this.houseId), 'このハウスのメンバーではありません', 403);
    need(this.M.seatedAt(user.id) == null || this.M.seatedAt(user.id) === this.id, 'すでに別の卓に座っています。先に退席してください');
    need(this.seatOf(user.id) < 0, 'すでに着席しています');
    need(this.count() < this.s.seats, '満席です');
    if (this.status === 'running') {
      need(this.s.startMode === 'free' || this.s.lateJoin !== 'deny', 'この卓は開始後の途中参加ができません');
      need(this.s.lateJoin !== 'deny', 'この卓は開始後の途中参加ができません');
    }
  }
  async join(user, buyIn) {
    this.joinCheck(user);
    const s = this.s;
    const chips = s.startMode === 'condition' ? s.chips : Math.floor(Number(buyIn));
    need(Number.isInteger(chips) && chips >= s.ante + s.reserve + s.limit, `持ち込みは${s.ante + s.reserve + s.limit}チップ以上です`);
    const due = this.M.opt.entryFee ? this.core.entryDue(user.id, this.now()) : 0;
    need(this.core.pocket(user.id) >= chips + due, due ? `ポケットのチップが足りません(持ち込み${chips} + 参加費${due} = ${chips + due}チップ必要)` : 'ポケットのチップが足りません');
    if (this.status === 'running' && s.lateJoin === 'vote' && this.count() >= 1) return this.startVote(user, chips);
    return this.seat(user, chips);
  }
  seat(user, chips) {
    const idx = this.seats.findIndex(x => !x);
    need(idx >= 0, '満席です');
    this.L.transfer('u:' + user.id, this.acct(user.id), chips, 'buyin', { actor: user.id, ref: 'table' + this.id });
    this.seats[idx] = { userId: user.id, username: user.username, joinedAt: Date.now(), away: false, manualAway: false, timeouts: 0 };
    Object.assign(this.T.players[idx], { pts: chips, vacant: false, name: user.username }); Solo.jpForget(this.T, idx);   // 途中参加は、参加してからの積み上がり分だけが対象
    this.M.userTable.set(user.id, this.id);
    this.addLog(`${user.username}が着席しました`, 'info');
    this.checkSharedDevice(user);
    this.broadcast();
    this.maybeStart();
    return { seat: idx };
  }
  checkSharedDevice(user) {   // 同じ端末・同じIPのアカウントが同じ卓にいたら、疑いとして記録
    const rows = this.core.db.prepare('SELECT device_id,ip FROM devices WHERE user_id=?').all(user.id);
    for (const st of this.seats) {
      if (!st || st.userId === user.id) continue;
      const other = this.core.db.prepare('SELECT device_id,ip FROM devices WHERE user_id=?').all(st.userId);
      const dev = rows.some(a => other.some(b => b.device_id === a.device_id));
      const ip = rows.some(a => a.ip && other.some(b => b.ip === a.ip));
      if (dev || ip) { this.core.suspect(user.id, dev ? 'same_table_device' : 'same_table_ip', { with: st.userId, table: this.id }); this.core.suspect(st.userId, dev ? 'same_table_device' : 'same_table_ip', { with: user.id, table: this.id }); }
    }
  }
  startVote(user, chips) {
    need(!this.vote || this.vote.done, '別の参加投票が進行中です');
    const v = this.vote = { id: Date.now(), userId: user.id, username: user.username, chips, yes: new Set(), no: new Set(), expires: Date.now() + this.M.opt.voteMs, done: false, user };
    this.addLog(`${user.username}が途中参加を希望しています。投票してください`, 'info');
    v.timer = setTimeout(() => this.closeVote(false, '時間切れ'), this.M.opt.voteMs);
    this.broadcast();
    return { vote: true };
  }
  castVote(user, yes) {
    const v = this.vote; need(v && !v.done, '投票はありません');
    need(this.seatOf(user.id) >= 0, '着席している人だけが投票できます');
    v.yes.delete(user.id); v.no.delete(user.id); (yes ? v.yes : v.no).add(user.id);
    const n = this.count(), majority = Math.floor(n / 2) + 1;
    if (v.yes.size >= majority) this.closeVote(true); else if (v.no.size >= n - majority + 1) this.closeVote(false, '反対多数');
    else this.broadcast();
  }
  closeVote(ok, why) {
    const v = this.vote; if (!v || v.done) return; v.done = true; clearTimeout(v.timer);
    if (ok) {
      try { this.joinCheckAfterVote(v.user); this.seat(v.user, v.chips); this.addLog(`${v.username}の参加が承認されました`, 'info'); }
      catch (e) { this.addLog(`${v.username}の参加ができませんでした(${e.message})`, 'info'); }
    } else this.addLog(`${v.username}の参加は認められませんでした(${why})`, 'info');
    this.broadcast();
  }
  joinCheckAfterVote(user) { need(this.count() < this.s.seats, '満席です'); need(this.M.seatedAt(user.id) == null, '別の卓に座っています'); need(this.core.pocket(user.id) >= this.vote.chips + (this.M.opt.entryFee ? this.core.entryDue(user.id, this.now()) : 0), 'ポケットが足りません'); }
  gameActive() { return !!(this.T.g && this.T.g.phase !== 'done' && this.loopOn && this.inGame); }
  inHand(i) { return this.gameActive() && this.T.g.parts.includes(i); }
  leaveCheck(uid) {
    const i = this.seatOf(uid); if (i < 0) return { ok: false, why: '着席していません' };
    const s = this.s, st = this.seats[i];
    if (s.startMode === 'condition' && this.status === 'running') return { ok: false, why: '条件開始の卓は、終了まで退席できません' };
    if (s.leave !== 'allow' && this.status === 'running') return { ok: false, why: 'この卓は途中退席ができません' };
    const wait = this.M.opt.minStayMs - (Date.now() - st.joinedAt);
    if (this.status === 'running' && wait > 0) return { ok: false, why: `着席から${Math.round(this.M.opt.minStayMs / 60000)}分間は退席できません(あと${Math.ceil(wait / 60000)}分)` };
    return { ok: true };
  }
  leave(user) {
    const c = this.leaveCheck(user.id); need(c.ok, c.why);
    const i = this.seatOf(user.id);
    if (this.inHand(i) || this.T.pot > 0 && this.status === 'running') { this.seats[i].leaveQueued = true; this.addLog(`${user.username}は、このゲームの後に退席します`, 'info'); this.broadcast(); return { queued: true }; }
    this.removeSeat(i, 'leave'); return { left: true };
  }
  removeSeat(i, why) {
    const st = this.seats[i]; if (!st) return;
    const p = this.T.players[i], amount = p.pts;
    this.persist();   // 台帳と一致させてから返す
    const bal = this.L.balance(this.acct(st.userId));
    if (bal > 0) this.L.transfer(this.acct(st.userId), 'u:' + st.userId, bal, 'cashout', { actor: st.userId, ref: 'table' + this.id, note: why });
    Object.assign(p, { pts: 0, vacant: true, name: '' }); Solo.jpForget(this.T, i); this.seats[i] = null; this.M.userTable.delete(st.userId);
    this.addLog(`${st.username}が退席しました`, 'info');
    const set = this.subs.get(st.userId); if (set) for (const r of set) { try { r.write('data: ' + JSON.stringify({ id: this.id, kicked: true, why }) + '\n\n'); } catch (e) {} }
    this.broadcast();
    if (this.count() === 0 && this.T.jp.pool > 0 && !(this.T.g && this.T.g.phase !== 'done')) {   // 人が0になった時点で残っている積立は、運営の保管へ
      const pool = this.T.jp.pool; this.T.feeNew += pool; this.T.jp.pool = 0; this.addLog(`積立 ${pool}チップは、人がいなくなったため運営の保管へ入りました`, 'info'); this.persist();
    }
    if (this.status === 'open' && this.count() === 0) this.M.save(this);
  }
  setAway(user, away) {
    const i = this.seatOf(user.id); need(i >= 0, '着席していません');
    if (away && this.s.startMode === 'condition' && this.status === 'running') { const w = this.M.opt.minStayMs - (Date.now() - this.seats[i].joinedAt); need(w <= 0, `条件開始の卓は、着席から${Math.round(this.M.opt.minStayMs / 60000)}分たつと離席できます(あと${Math.ceil(w / 60000)}分)`); }
    this.seats[i].away = !!away; this.seats[i].manualAway = !!away;
    this.addLog(`${user.username}が${away ? '離席しました(自動で降り続けます)' : '戻りました'}`, 'info');
    if (!away) this.feeTick();
    if (away) this.autoFoldPending(i);
    this.broadcast();
  }
  // ポケットと卓のチップの移動(自由な卓のみ。自分がゲーム中でないとき)
  exchange(user, dir, amount) {
    need(this.s.startMode === 'free', '条件開始の卓ではポケットと卓のチップを移せません');
    const i = this.seatOf(user.id); need(i >= 0, '着席していません');
    need(!this.inHand(i), 'ゲーム中は移せません。次のゲームの前に行ってください');
    amount = Math.floor(Number(amount)); need(Number.isInteger(amount) && amount > 0, '数を入力してください');
    const p = this.T.players[i];
    if (dir === 'in') { need(this.core.pocket(user.id) >= amount, 'ポケットが足りません'); this.persist(); this.L.transfer('u:' + user.id, this.acct(user.id), amount, 'chip_in', { actor: user.id, ref: 'table' + this.id }); p.pts += amount; }
    else { need(p.pts >= amount, 'チップが足りません'); this.persist(); this.L.transfer(this.acct(user.id), 'u:' + user.id, amount, 'chip_out', { actor: user.id, ref: 'table' + this.id }); p.pts -= amount; }
    this.broadcast();
  }
  say(user, body) {
    need(this.s.chat && this.M.opt.chatEnabled, 'メッセージ機能は、この卓では使えません');
    need(this.seatOf(user.id) >= 0, '着席している人だけが送れます');
    body = String(body || '').trim().slice(0, 200); need(body, '空のメッセージは送れません');
    const now = Date.now(); this.lastChat = this.lastChat || {}; need(!(this.lastChat[user.id] && now - this.lastChat[user.id] < 800), '送信が速すぎます');
    this.lastChat[user.id] = now;
    this.core.db.prepare('INSERT INTO chat(table_id,user_id,body,ts) VALUES(?,?,?,?)').run(this.id, user.id, body, now);
    this.chat.push({ t: now, name: user.username, body }); this.broadcast();
  }

  // ---- 台帳との同期 ----
  persist() {
    const entries = [];
    this.seats.forEach((st, i) => { if (!st) return; const d = this.T.players[i].pts - this.L.balance(this.acct(st.userId)); if (d) entries.push({ acct: this.acct(st.userId), delta: d }); });
    const pd = this.T.pot - this.L.balance(this.potAcct()); if (pd) entries.push({ acct: this.potAcct(), delta: pd });
    const jd = this.T.jp.pool - this.L.balance(this.jpAcct()); if (jd) entries.push({ acct: this.jpAcct(), delta: jd });   // ジャックポットの積立は、卓ごとの保管へ
    const fee = this.T.feeNew || 0; if (fee) entries.push({ acct: 'f:' + this.id, delta: fee });   // 毎ゲームの手数料は、卓ごとの保管へ
    if (!entries.length) return;
    const sum = entries.reduce((a, e) => a + e.delta, 0);
    if (sum !== 0) throw new Error(`卓${this.id}: チップの合計が合いません(差${sum})。この卓を停止します`);
    this.L.move(entries, 'game', { ref: 'table' + this.id + ':g' + this.T.gameNo });
    if (fee) { this.T.feeNew = 0; this.core.addRake(this.id, fee, 'ゲーム' + this.T.gameNo, this.now()); }
  }

  // ---- 参加費(時間ごと。ポケットから引く) ----
  feeTick(now) {
    const M = this.M; if (!M.opt.entryFee || this.status !== 'running') return;
    now = now || this.now(); const core = this.core; let changed = false;
    this.seats.forEach((st, i) => {
      if (!st) return;
      const u = core.user(st.userId); if (!u || u.role === 'creator' || u.role === 'sovereign') return;
      const pl = this.T.players[i], p = core.passRow(st.userId, now);
      if (p.paid_until > now) {   // 払い済みの時間の中
        if (pl.sitout) { pl.sitout = false; st.blocked = false; changed = true; }
        if (p.paid_until - now <= M.opt.feeWarnMs && !st.manualAway && p.warned_for !== p.paid_until) {
          const next = core.entryFeeNow(st.userId, now);
          if (core.pocket(st.userId) < next) { core.savePass(Object.assign({}, p, { warned_for: p.paid_until })); core.notify(st.userId, 'fee_warn', { table: this.id, minutes: Math.max(1, Math.ceil((p.paid_until - now) / 60000)), need: next, pocket: core.pocket(st.userId) }); }
        }
        return;
      }
      // 時間が切れている: 自分で離席を押している人は引かない。それ以外(接続切れ含む)は自動で引き、足りなければ休み。
      // 「離席」を自分で押している人: ゲームの参加料は毎ゲーム払い続け(自動で降りる)、参加費だけは自動で引かない。戻った時に、時間が過ぎていれば払う。
      if (st.manualAway) { st.feeGap = true; return; }
      const amt = core.chargeEntry(st.userId, this.id, now, !st.feeGap);
      if (amt) { st.feeGap = false; st.blocked = false; if (pl.sitout) pl.sitout = false; this.addLog(`${st.username}の参加費 ${amt}チップを、ポケットから引きました`, 'info'); changed = true; }
      else {
        st.feeGap = true; if (!pl.sitout) { pl.sitout = true; changed = true; }
        if (!st.blocked) {
          st.blocked = true; core.savePass(Object.assign({}, p, { blocked: 1 }));
          core.notify(st.userId, 'fee_blocked', { table: this.id, need: core.entryFeeNow(st.userId, now), pocket: core.pocket(st.userId) });
          this.addLog(`${st.username}はポケットに参加費がないため、チップが入るまでお休みです`, 'info');
        }
      }
    });
    if (changed) this.broadcast();
  }

  // ---- 進行 ----
  maybeStart() {
    if (this.status === 'open') {
      const ready = this.s.startMode === 'condition' ? this.count() >= this.s.minPlayers : this.seats.filter((x, i) => x && this.canPlay(i)).length >= 2;
      if (ready) { this.status = 'running'; this.startedAt = Date.now(); this.M.save(this); this.addLog('卓が始まります', 'info'); }
    }
    if (this.status === 'running') this.feeTick();
    if (this.status === 'running' && !this.loopOn) this.loop();
  }
  netMap() {   // この卓での、人ごとの勝ち負け(チップの+−)。全ゲームの合計
    if (!this._net) { this._net = {}; for (const row of this.core.db.prepare('SELECT result FROM games WHERE table_id=?').all(this.id)) { let d = {}; try { d = JSON.parse(row.result) || {}; } catch (e) {} for (const [k, v] of Object.entries(d)) this._net[k] = (this._net[k] || 0) + v; } }
    return this._net;
  }
  async human(req) {
    const i = req.seat, st = this.seats[i];
    const pass = req.type === 'carryJoin' ? { act: 'skip' } : { act: 'fold' };   // 流しの次の試合は、応答がなければ見送り(払わない)
    // チップが足りない人には、離席中でも猶予時間(既定5分)を渡す。その間にAJからチップをもらって戻れる。
    if (!st) return pass;
    if (!req.short && (st.away || !this.connected(i))) { this.addLog(`${st.username}は離席中のため、自動で${req.type === 'carryJoin' ? '見送り' : '降り'}ました`, 'fold'); return pass; }
    return new Promise(resolve => {
      const ms = req.short ? this.M.opt.graceMs : this.M.opt.turnMs;
      const deadline = Date.now() + ms;
      const p = { req, resolve, deadline, askedAt: Date.now() };
      if (req.short) this.shortPend.set(i, p); else this.pending = p;
      if (req.short) this.addLog(`${st.username}はチップが足りません(必要${req.need}チップ・今${req.have}チップ)。${Math.round(ms / 60000 * 10) / 10}分だけ待ちます`, 'info');
      p.timer = setTimeout(() => {
        if (req.short ? this.shortPend.get(i) !== p : this.pending !== p) return;
        if (req.short) {
          // 戻ってこなかった=迷惑行為。3回目で退会。
          let r = null; try { r = this.core.nuisance(st.userId, 'carry_noshow', { table: this.id }); } catch (e) { console.error(e); }
          this.addLog(`${st.username}は時間内に戻らなかったため、不参加で始めます${r && r.count ? `(迷惑行為${r.count}回目${r.expelled ? '・退会' : ''})` : ''}`, 'fold');
          return this.resolveShort(i, pass);
        }
        st.timeouts = (st.timeouts || 0) + 1;
        this.addLog(`${st.username}は時間切れで${req.type === 'carryJoin' ? '見送り' : '降り'}ました`, 'fold');
        if (st.timeouts >= 2) { st.away = true; this.addLog(`${st.username}は応答がないため離席扱いです`, 'info'); }
        this.resolvePending(pass, true);
      }, ms);
      this.broadcast();
    });
  }
  resolveShort(i, resp) {
    const p = this.shortPend.get(i); if (!p) return; clearTimeout(p.timer); this.shortPend.delete(i); p.resolve(resp); this.broadcast();
  }
  resolvePending(resp, auto) {
    const p = this.pending; if (!p) return; clearTimeout(p.timer); this.pending = null;
    if (!auto) {   // 操作が速すぎる(自動操作の疑い)を数える
      const st = this.seats[p.req.seat], dt = Date.now() - p.askedAt;
      if (st) { this.fastCount[st.userId] = dt < 150 ? (this.fastCount[st.userId] || 0) + 1 : 0; if (this.fastCount[st.userId] === 20) this.core.suspect(st.userId, 'too_fast', { table: this.id }); st.timeouts = 0; }
    }
    p.resolve(resp);
  }
  act(user, a) {
    const i = this.seatOf(user.id);
    const p = this.shortPend.get(i) || this.pending; need(p, '今はあなたの番ではありません');
    need(i === p.req.seat, '今はあなたの番ではありません');
    const t = p.req.type, act = a && a.act;
    if (t === 'oya') need(['bet', 'fold', 'show'].includes(act), '操作が正しくありません');
    else if (t === 'carryJoin') {
      need(['join', 'skip'].includes(act), '操作が正しくありません');
      if (p.req.short && act === 'join') { const have = Math.max(0, this.T.players[i].pts - this.T.cfg.reserve); need(have >= p.req.need, `まだチップが足りません(必要${p.req.need}チップ・今${have}チップ)。AJにチップをもらい、卓に移してから押してください`); }
    }
    else need(['follow', 'fold'].includes(act), '操作が正しくありません');
    if (p.req.short) return this.resolveShort(i, { act });
    this.resolvePending({ act, amount: Number(a.amount), up: Number(a.up) || 0 });
  }
  async loop() {
    this.loopOn = true; const M = this.M;
    try {
      while (this.status === 'running') {
        this.beat = Date.now();
        if (this.stopReq) break;
        const present = this.seats.filter((st, i) => st && !st.away && this.connected(i)).length;
        if (present === 0) { await sleep(500); continue; }          // 全員が離席なら一時停止
        this.inGame = true;
        const io = { log: (m, k) => { this.addLog(m, k); }, sync: () => this.broadcast(), beat: ms => sleep(ms * M.opt.beatScale), human: r => this.human(r), grace: this.s.startMode === 'free' };
        this.T.feeBp = M.opt.feeBp; this.T.jpBp = M.opt.jackpotBp; this.T.cfg.jpRank = M.opt.jpRank;   // 設定の変更を、次のゲームから反映
        const r = await Solo.playGame(this.T, io);
        this.inGame = false;
        if (r.type === 'nogame') {
          if (this.s.startMode === 'condition' || this.startedOnce) { if (await this.endConditions(true)) break; }
          await sleep(500 * Math.max(0.1, M.opt.beatScale)); continue;
        }
        this.startedOnce = true;
        this.afterGame(r);
        if (await this.endConditions(false)) break;
        await sleep(5000 * M.opt.beatScale);   // 集める演出→1秒→山札が上がる演出の時間
      }
    } catch (e) {
      console.error('table error', this.id, this.name, e);
      M.tableErrors.push(Date.now()); if (M.tableErrors.length > 1000) M.tableErrors.shift();
      this.inGame = false; try { this.addLog('エラーのため卓を停止しました: ' + e.message, 'info'); this.endTable('error'); } catch (e2) {}
    } finally { this.loopOn = false; if (this.stopReq && this.status === 'running') this.endTable('stopped'); }
  }
  afterGame(r) {
    this.peeked = {};   // 手札確認チケットで見た記録は、そのゲームだけ
    this.persist();
    const g = this.T.g, how = r.type === 'win' ? r.how : 'nagashi';
    const byName = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [this.seats[k] ? this.seats[k].username : k, v]));
    this.lastGame = { no: g.no, how, winner: r.winner != null ? this.seats[r.winner] && this.seats[r.winner].username : null, deltas: Object.fromEntries(Object.entries(r.deltas || {}).map(([k, v]) => [this.seats[k] ? this.seats[k].username : k, v])), pot: r.potWon || 0, fee: r.type === 'win' ? (r.fee || 0) : 0, cut: r.type === 'win' ? (r.cut || 0) : 0, jp: r.jp || null, shugi: r.shugi ? r.shugi.total : 0, shugiRank: r.shugi ? r.shugi.rank : 0, hash: g.commit.hash,
      paid: byName(r.paid), stake: byName(r.stake), reveal: null, hands: how === 'fold' && !g.revealed.length ? null : Object.fromEntries(g.revealed.map(s => [this.seats[s] ? this.seats[s].username : s, g.hands[s].map(c => c.n + c.s)])) };
    this.peekPool = how === 'fold' && !g.revealed.length ? Object.fromEntries(g.parts.filter(s => this.seats[s] && g.hands[s]).map(s => [this.seats[s].username, g.hands[s].map(c => c.n + c.s)])) : {};   // 手札確認チケット用(画面には出さない。メモリだけ)
    const nameOf = s => this.seats[s] ? this.seats[s].username : String(s), uidOf = s => this.seats[s] ? this.seats[s].userId : null;
    const dataRec = {
      no: g.no, ts: Date.now(), how, color: g.color, oya: nameOf(g.firstOya), carried: g.carried || 0, potWon: r.potWon || 0, fee: r.type === 'win' ? (r.fee || 0) : 0, cut: r.type === 'win' ? (r.cut || 0) : 0, jp: r.jp ? { paid: r.jp.paid, pool: r.jp.pool, last: !!r.jp.last } : null, shugi: r.shugi ? r.shugi.total : 0,
      parts: g.parts.map(s => ({ name: nameOf(s), uid: uidOf(s) })),
      actions: (r.actions || []).map(a => ({ round: a.round, name: nameOf(a.seat), act: a.act, amount: a.amount })),
      paid: this.lastGame.paid, stake: this.lastGame.stake, deltas: this.lastGame.deltas,
      allHands: g.parts.map(s => ({ name: nameOf(s), uid: uidOf(s), hand: g.hands[s].map(c => c.n + c.s), folded: !g.revealed.includes(s) })),   // 作成者・統括責任者だけが見られる(参加者には出さない)
      showdown: (r.showdown || []).map(x => ({ name: nameOf(x.seat), uid: uidOf(x.seat), hand: x.hand, label: x.label }))
    };
    this.core.db.prepare('INSERT INTO games(table_id,no,ts,color,hash,commit_str,how,winner,result,data) VALUES(?,?,?,?,?,?,?,?,?,?)').run(this.id, g.no, Date.now(), g.color, g.commit.hash, g.commit.str, how, this.lastGame.winner, JSON.stringify(this.lastGame.deltas), JSON.stringify(dataRec));
    if (this.core.onGame) { try { this.core.onGame(this.id, Object.assign({ winner: this.lastGame.winner }, dataRec)); } catch (e) { console.error('戦績の記録', e); } }   // 戦績(本人だけが見る)
    this._net = null;
    if (r.type === 'win' && how === 'show') this.trackFlow(r, g);
    this.M.save(this);
    // 退席予約・離席のあと始末
    this.seats.forEach((st, i) => { if (st && st.leaveQueued && this.T.pot === 0) { st.leaveQueued = false; try { this.removeSeat(i, 'leave'); } catch (e) { console.error(e); } } });
    this.broadcast();
  }
  trackFlow(r, g) {   // 同じ相手にだけ負け続ける人を見つける(チップの受け渡しの疑い)
    const w = r.winner;
    for (const s of g.parts) {
      if (s === w || !g.revealed.includes(s)) continue;
      const a = this.seats[s], b = this.seats[w]; if (!a || !b) continue;
      const m = this.pairLoss[a.userId] = this.pairLoss[a.userId] || { total: 0, to: {} };
      m.total++; m.to[b.userId] = (m.to[b.userId] || 0) + 1;
      if (m.total >= 10 && m.total % 10 === 0) { const top = Math.max(...Object.values(m.to)); if (top / m.total >= 0.85) { this.core.suspect(a.userId, 'chip_dump', { to: b.userId, table: this.id }); this.core.suspect(b.userId, 'chip_dump', { from: a.userId, table: this.id }); } }
    }
  }
  async endConditions(nogame) {
    const s = this.s; let why = null;
    // 持ち越しの場があっても、次のゲームができない(出られる人が2人未満・または参加者が2人に満たず開始できなかった)なら待たずに終える。残った場は endTable が残っている人で分ける
    const clear = this.T.pot === 0 || nogame || this.seats.filter((st, i) => st && this.canPlay(i)).length < 2;
    if (s.durationMin && this.startedAt && Date.now() - this.startedAt >= s.durationMin * 60000 && clear) { this.addLog('時間になったので、このゲームで終了します', 'info'); why = 'time'; }
    else {
      const out = this.seats.filter((st, i) => st && !this.canPlay(i)).length;
      if (s.endZero && out >= s.endZero && clear) { this.addLog(`${out}人がゲームに出られなくなったので終了します`, 'info'); why = 'zero'; }
      else if (nogame && s.startMode === 'condition') why = 'nogame';
      else if (this.stopReq && this.T.pot === 0) why = 'stopped';
    }
    if (!why) return false;
    if (why !== 'stopped') await this.runLast();   // 終わる前に、積立だけを賭けたラストゲーム(1回だけ)
    this.endTable(why); return true;
  }
  // ラストゲーム: 積み立てられたチップだけを、手札の強さで決める。参加料・ベット・親・祝儀はなし。
  async runLast() {
    const M = this.M; if (!(this.T.jp.pool > 0) || !M.opt.jpLast) return;
    this.inGame = true;
    try {
      const io = { log: (m, k) => this.addLog(m, k), sync: () => this.broadcast(), beat: ms => sleep(ms * M.opt.beatScale),
        roundDone: async r => { this.afterGame(r); await sleep(5000 * M.opt.beatScale); } };
      await Solo.playLastGame(this.T, io);
    } finally { this.inGame = false; }
    this.persist();
  }
  endTable(why) {
    if (this.status === 'ended' || this.status === 'stopped') return;
    if (why === 'error') {   // 台帳が合わないときは、直前に記録できた状態のまま全員のポケットへ戻す
      const holders = this.seats.map((st, i) => st ? i : -1).filter(i => i >= 0), potA = this.L.balance(this.potAcct());
      if (potA > 0 && holders.length) { const sh = Math.floor(potA / holders.length), rs = potA - sh * holders.length; holders.forEach((i, k) => this.L.transfer(this.potAcct(), this.acct(this.seats[i].userId), sh + (k === 0 ? rs : 0), 'recover_pot', { ref: 'table' + this.id })); }
      const jb = this.L.balance(this.jpAcct());   // 積立は、積み上げ分に応じて座っている人へ(誰もいなければ保管へ)
      if (jb > 0) {
        this.T.jp.pool = jb; const sh = Object.entries(Solo.jpShares(this.T)).filter(([si, a]) => a > 0 && this.seats[si]);
        if (sh.length) sh.forEach(([si, a]) => this.L.transfer(this.jpAcct(), this.acct(this.seats[si].userId), a, 'recover_jp', { ref: 'table' + this.id }));
        else this.L.transfer(this.jpAcct(), 'f:' + this.id, jb, 'recover_jp', { ref: 'table' + this.id });
        this.T.jp.pool = 0;
      }
      this.T.pot = 0; this.T.players.forEach((p, i) => { if (this.seats[i]) p.pts = this.L.balance(this.acct(this.seats[i].userId)); });
    }
    // 場に残った持ち越しは、残っている人で等分して返す
    if (this.T.pot > 0) {
      const ids = this.T.carry && this.T.carry.survivors.filter(s => this.seats[s]).length ? this.T.carry.survivors.filter(s => this.seats[s]) : this.seats.map((st, i) => st ? i : -1).filter(i => i >= 0);
      const share = Math.floor(this.T.pot / ids.length), rest = this.T.pot - share * ids.length;
      ids.forEach((s, k) => { this.T.players[s].pts += share + (k === 0 ? rest : 0); });
      this.T.pot = 0; this.T.carry = null;
    }
    if (why !== 'error' && this.T.jp.pool > 0) {   // 強制終了などで残った積立は、積み上げ分に応じて分ける
      const sh = Solo.jpShares(this.T), pool = this.T.jp.pool;
      if (Object.keys(sh).length) { Object.entries(sh).forEach(([si, a]) => { this.T.players[si].pts += a; }); this.T.jp.pool = 0; this.addLog(`積立 ${pool}チップを、積み上げ分に応じて ${Object.keys(sh).length}人に分けました`, 'info'); }
    }
    if (why !== 'error' && this.T.jp.pool > 0) {   // 受け取る人がいない積立(全員が席を立ったあとなど): 座っている人がいれば等分、いなければ運営の保管へ
      const hold = this.seats.map((st, i) => st ? i : -1).filter(i => i >= 0), pool = this.T.jp.pool;
      if (hold.length) { const sh = Math.floor(pool / hold.length), rs = pool - sh * hold.length; hold.forEach((i, k) => { this.T.players[i].pts += sh + (k === 0 ? rs : 0); }); this.addLog(`積立 ${pool}チップを、残っている人で等分しました`, 'info'); }
      else this.T.feeNew += pool;
      this.T.jp.pool = 0;
    }
    if (why !== 'error') this.persist();
    this.status = why === 'stopped' || why === 'error' ? 'stopped' : 'ended';
    this.seats.forEach((st, i) => { if (st) { const bal = this.L.balance(this.acct(st.userId)); if (bal > 0) this.L.transfer(this.acct(st.userId), 'u:' + st.userId, bal, 'cashout', { actor: st.userId, ref: 'table' + this.id, note: why }); } });
    this.addLog('卓が終了しました。チップはポケットに戻りました', 'info');
    this.endedFinal = this.seats.map((st, i) => st ? { name: st.username, chips: this.T.players[i].pts } : null).filter(Boolean);
    this.seats.forEach((st) => { if (st) this.M.userTable.delete(st.userId); });
    this.M.save(this); this.broadcast();
    for (const [uid, set] of this.subs) for (const r of set) { try { r.write('data: ' + JSON.stringify(Object.assign(this.view(uid), { ended: true })) + '\n\n'); } catch (e) {} }   // 見る人ごとに作る(着席していた人には、自分の分の数字が入る)
  }
  stop() { this.stopReq = true; if (this.status === 'open' || !this.inGame) { if (this.status === 'running' && this.loopOn) { /* ループが次の周回で終了 */ } else this.endTable('stopped'); } this.addLog('AJが卓を止めます(今のゲームの後に終了)', 'info'); this.broadcast(); }
}

class Tables {
  constructor(core, opt) {
    this.core = core; this.rt = new Map(); this.userTable = new Map();
    this.tableErrors = [];   // エラーで止まった時刻(健康診断で数える)
    this.opt = Object.assign({ turnMs: 40000, voteMs: 60000, graceMs: 5 * 60000, minStayMs: 15 * 60000, disconnectGraceMs: 8000, beatScale: 1, chatEnabled: true, ads: false,
      minUnit: 100, feeBp: 100, jackpotBp: 200, jpRank: 10, jpLast: 1, shugiMin: 1, entryFee: true, feeTickMs: 30000, feeWarnMs: 5 * 60000, clock: () => Date.now() }, opt || {});
    core.onUserBanned = uid => this.evict(uid);
    core.tablesOpt = this.opt; core.loadConfig();
    if (this.opt.feeTickMs > 0) { this.timer = setInterval(() => { for (const rt of this.rt.values()) { try { rt.feeTick(); } catch (e) { console.error('feeTick', e); } } }, this.opt.feeTickMs); if (this.timer.unref) this.timer.unref(); }
  }
  seatedAt(uid) { return this.userTable.get(uid); }
  // 動いているはずなのに、ms より長く何も起きていない卓の数(固まった卓)
  stalled(ms, now = Date.now()) { let n = 0; for (const rt of this.rt.values()) if (rt.status === 'running' && rt.loopOn && now - (rt.beat || now) > ms) n++; return n; }
  save(rt) {
    this.core.db.prepare('UPDATE tables_ SET status=?,started_at=?,ended_at=?,state=? WHERE id=?').run(rt.status, rt.startedAt, ['ended', 'stopped'].includes(rt.status) ? Date.now() : null, JSON.stringify({ gameNo: rt.T.gameNo, pot: rt.T.pot, jp: rt.jpEntByUser() }), rt.id);
  }
  create(actor, name, raw) {
    need(actor.role === 'aj', '卓を作れるのはAJだけです', 403);
    const h = this.core.houseOf(actor.id);
    need(this.core.tableCount(h.id) < h.table_limit, `このハウスの卓の上限(${h.table_limit}卓)に達しています。上限を上げるには申請してください`);
    const s = normSettings(raw, null, this.opt.minUnit, this.opt.shugiMin);
    const r = this.core.db.prepare('INSERT INTO tables_(house_id,name,settings,created_at) VALUES(?,?,?,?)').run(h.id, String(name || '卓').slice(0, 20), JSON.stringify(s), Date.now());
    this.core.D.audit(actor.id, 'table_create', Number(r.lastInsertRowid));
    return this.get(Number(r.lastInsertRowid)).summary();
  }
  get(id) {
    id = Number(id); if (this.rt.has(id)) return this.wrap(this.rt.get(id));
    const row = this.core.db.prepare('SELECT * FROM tables_ WHERE id=?').get(id); need(row, '卓が見つかりません', 404);
    const rt = new Runtime(this, row); this.rt.set(id, rt); return this.wrap(rt);
  }
  wrap(rt) { rt.summary = () => this.summary(rt); return rt; }
  summary(rt) {
    return { id: rt.id, houseId: rt.houseId, name: rt.name, status: rt.status, settings: rt.s, seated: rt.count(), seats: rt.s.seats, players: rt.seats.filter(Boolean).map(x => x.username) };
  }
  list(houseId) {
    return this.core.db.prepare("SELECT id FROM tables_ WHERE house_id=? AND status IN ('open','running') ORDER BY id").all(houseId).map(r => this.summary(this.get(r.id)));
  }
  updateSettings(actor, id, name, raw) {
    const rt = this.get(id); const h = this.core.houseOf(actor.id);
    need(actor.role === 'aj' && h && h.id === rt.houseId, 'このハウスのAJだけが変更できます', 403);
    need(rt.count() === 0 && rt.status === 'open', '着席している人がいる間は、設定を変更できません');
    need(rt.T.jp.pool === 0 && rt.T.pot === 0, 'ジャックポットの払い出しが終わるまで、参加料・ベット額・アップ額の設定は変えられません');
    rt.s = normSettings(raw, rt.s, this.opt.minUnit, this.opt.shugiMin); if (name) rt.name = String(name).slice(0, 20);
    this.core.db.prepare('UPDATE tables_ SET settings=?,name=? WHERE id=?').run(JSON.stringify(rt.s), rt.name, rt.id);
    rt.seats = Array.from({ length: rt.s.seats }, () => null); rt.buildEngine(); return this.summary(rt);
  }
  stop(actor, id) {
    const rt = this.get(id); const h = this.core.houseOf(actor.id);
    need((actor.role === 'aj' && h && h.id === rt.houseId) || actor.role === 'creator' || actor.role === 'sovereign', 'このハウスのAJだけが止められます', 403);
    rt.stop(); return { stopping: true };
  }
  stopAll() {   // システム更新のため、動いている卓をすべて止める(今のゲームのあとに終了し、チップはポケットへ戻る)
    let n = 0; for (const r of this.core.db.prepare("SELECT id FROM tables_ WHERE status IN ('open','running')").all()) { const rt = this.get(r.id); if (rt.status === 'running' || rt.count() > 0) { rt.stop(); n++; } } return n;
  }
  evict(uid) {   // 退会などで、座っている人を外してチップをポケットへ戻す
    const id = this.userTable.get(uid); if (!id) return;
    const rt = this.rt.get(id); if (!rt) return;
    const i = rt.seatOf(uid); if (i < 0) return;
    if (rt.inHand(i)) { rt.autoFoldPending(i); rt.seats[i].away = true; rt.seats[i].leaveQueued = true; }
    else rt.removeSeat(i, 'evict');
  }
  // 起動時の復旧: 中断された卓のチップを、直前のゲーム終了時点のまま、持ち主のポケットに戻す
  recover() {
    const core = this.core, L = core.L; let n = 0;
    for (const t of core.db.prepare("SELECT id FROM tables_ WHERE status IN ('open','running')").all()) {
      const stacks = core.db.prepare("SELECT acct,balance FROM accounts WHERE acct LIKE ? AND balance>0").all('s:' + t.id + ':%');
      const potA = L.balance('p:' + t.id);
      const jb = L.balance('j:' + t.id);   // 積立: 保存してある積み上げ分に応じてポケットへ(記録がなければ卓の保管へ)
      if (jb > 0) {
        let ent = {}; try { ent = (JSON.parse(core.db.prepare('SELECT state FROM tables_ WHERE id=?').get(t.id).state || '{}').jp) || {}; } catch (e) {}
        const ids = Object.keys(ent).filter(k => ent[k] > 0), sum = ids.reduce((a, k) => a + ent[k], 0);
        if (ids.length) { let given = 0; ids.forEach(k => { const a = Math.floor(jb * ent[k] / sum); given += a; if (a > 0) L.transfer('j:' + t.id, 'u:' + k, a, 'recover_jp', { ref: 'table' + t.id }); }); if (jb - given > 0) L.transfer('j:' + t.id, 'u:' + ids[0], jb - given, 'recover_jp', { ref: 'table' + t.id }); }
        else L.transfer('j:' + t.id, 'f:' + t.id, jb, 'recover_jp', { ref: 'table' + t.id });
      }
      if (potA > 0 && stacks.length) {
        const share = Math.floor(potA / stacks.length), rest = potA - share * stacks.length;
        stacks.forEach((s, k) => L.transfer('p:' + t.id, s.acct, share + (k === 0 ? rest : 0), 'recover_pot', { ref: 'table' + t.id }));
      }
      for (const s of core.db.prepare("SELECT acct,balance FROM accounts WHERE acct LIKE ? AND balance>0").all('s:' + t.id + ':%')) L.transfer(s.acct, 'u:' + s.acct.split(':')[2], s.balance, 'recover', { ref: 'table' + t.id });
      core.db.prepare("UPDATE tables_ SET status='stopped',ended_at=? WHERE id=?").run(Date.now(), t.id); n++;
    }
    return n;
  }
  games(id, viewer) {
    const rt = this.get(id); const ended = ['ended', 'stopped'].includes(rt.status);
    // 山札の全体(降りた人の手札も入っている)は、卓が終わってから公開する
    return this.core.db.prepare('SELECT no,ts,color,hash,commit_str,how,winner FROM games WHERE table_id=? ORDER BY no DESC LIMIT 100').all(rt.id)
      .map(g => ({ no: g.no, ts: g.ts, color: g.color, hash: g.hash, how: g.how, winner: g.winner, reveal: ended ? g.commit_str : null }));
  }
  // ゲームのデータ: チップの流れ・人の動き・勝者は、そのゲームに参加した人が見られる。
  // カードが見られるのは、勝負まで進んだ人(と作成者・統括責任者)だけ。降りた人のカードはデータに残さない。
  participated(id, uid) {
    for (const row of this.core.db.prepare('SELECT data FROM games WHERE table_id=?').all(Number(id))) { try { if (JSON.parse(row.data).parts.some(p => p.uid === uid)) return true; } catch (e) {} }
    return false;
  }
  gameData(id, viewer) {
    const rt = this.get(id), top = viewer.role === 'creator' || viewer.role === 'sovereign';
    const out = [];
    for (const row of this.core.db.prepare('SELECT no,ts,hash,how,winner,data FROM games WHERE table_id=? ORDER BY no DESC LIMIT 100').all(rt.id)) {
      let d; try { d = JSON.parse(row.data); } catch (e) { d = null; } if (!d) continue;
      const inGame = d.parts.some(p => p.uid === viewer.id), inShow = d.showdown.some(p => p.uid === viewer.id);
      if (!inGame && !top) continue;
      const canCards = inShow || top;
      out.push({ no: d.no, ts: row.ts, how: d.how, winner: row.winner, oya: d.oya, carried: d.carried, potWon: d.potWon, fee: d.fee || 0, cut: d.cut || 0, jp: d.jp || null, shugi: d.shugi, color: d.color,
        parts: d.parts.map(p => p.name), actions: d.actions, paid: d.paid, stake: d.stake, deltas: d.deltas,
        showdownNames: d.showdown.map(p => p.name),
        showdown: canCards ? d.showdown.map(p => ({ name: p.name, hand: p.hand, label: p.label })) : null, allHands: top ? (d.allHands || null) : null, you: viewer.username });
    }
    return out;
  }
}
module.exports = { Tables, normSettings, DEFAULTS, Runtime };
