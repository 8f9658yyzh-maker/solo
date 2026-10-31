'use strict';
// 戦績。1人1ゲームごとの記録(player_games)を、卓のゲームが終わるたびに足す。
// - 見られるのは自分の記録だけ。降りたゲームの自分の手札は、本人には見える(もともと自分のカード)
// - 無料: 直近7日の基本の数字。有料プラン(と作成者・統括・管理責任者): 期間を選べる・手役の内訳・日ごと・卓ごと
// - 勝ち負けの計算に使うだけで、チップの台帳には触れない
const Solo = require('../engine.js');
const { need } = require('./core');

const DAY = 86400000;
const FREE_DAYS = 7;
const STAFF = ['creator', 'sovereign', 'manager'];
const nums = hand => (hand || []).map(c => Number(String(c).match(/^\d+/)));

class Stats {
  constructor(D, core, billing) {
    this.D = D; this.db = D.db; this.core = core; this.billing = billing;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS player_games(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, table_id INTEGER NOT NULL, game_no INTEGER NOT NULL, ts INTEGER NOT NULL,
        delta INTEGER NOT NULL, won INTEGER NOT NULL, how TEXT, hand TEXT, cat TEXT, showdown INTEGER NOT NULL, folded INTEGER NOT NULL, oya INTEGER NOT NULL, pot INTEGER NOT NULL,
        UNIQUE(user_id,table_id,game_no));
      CREATE INDEX IF NOT EXISTS pg_user_ts ON player_games(user_id,ts);`);
    if (D.getMeta('pg_backfill', '0') !== '1') this.backfill();
  }
  // 以前のゲーム(この仕組みより前に終わったもの)も、games の記録から作り直す。1回だけ
  backfill() {
    let n = 0;
    this.D.tx(() => {
      for (const row of this.db.prepare('SELECT table_id,no,ts,winner,data FROM games ORDER BY id').all()) {
        let d; try { d = JSON.parse(row.data); } catch (e) { d = null; } if (!d) continue;
        n += this.record(row.table_id, Object.assign({ winner: row.winner }, d), row.ts);
      }
      this.D.setMeta('pg_backfill', '1');
    });
    return n;
  }
  // d: 卓が games に書くのと同じ形(dataRec)。winner は勝者のユーザー名
  record(tableId, d, ts) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO player_games(user_id,table_id,game_no,ts,delta,won,how,hand,cat,showdown,folded,oya,pot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const shown = new Set((d.showdown || []).map(x => x.uid));
    let n = 0;
    for (const p of d.allHands || []) {
      if (!p.uid) continue;
      const hand = nums(p.hand), cat = hand.length === 2 && hand.every(Boolean) ? Solo.category(hand[0], hand[1]) : null;
      const won = d.winner != null && d.winner === p.name ? 1 : 0;
      n += ins.run(p.uid, tableId, d.no, ts || d.ts || Date.now(), Number((d.deltas || {})[p.name]) || 0, won, d.how || null, (p.hand || []).join(' '), cat,
        shown.has(p.uid) ? 1 : 0, p.folded ? 1 : 0, d.oya === p.name ? 1 : 0, won ? Number(d.potWon) || 0 : 0).changes;
    }
    return n;
  }
  full(u) { return STAFF.includes(u.role) || !!(this.billing && this.billing.active(u.id)); }
  // days: 0=全期間。無料の人は7日まで
  mine(u, days, now = Date.now()) {
    const full = this.full(u);
    days = Math.floor(Number(days)); if (!Number.isFinite(days) || days < 0) days = FREE_DAYS;
    if (!full && (days === 0 || days > FREE_DAYS)) days = FREE_DAYS;
    need([0, 1, 7, 30, 90, 365].includes(days), '期間は 1・7・30・90・365日・全期間 から選んでください');
    const from = days ? now - days * DAY : 0;
    const rows = this.db.prepare('SELECT * FROM player_games WHERE user_id=? AND ts>=? ORDER BY ts').all(u.id, from);
    const sum = (f, a = rows) => a.reduce((s, r) => s + f(r), 0);
    const wins = sum(r => r.won), games = rows.length, sd = rows.filter(r => r.showdown);
    const base = {
      full, days, freeDays: FREE_DAYS, games, wins, winRate: games ? Math.round(wins / games * 1000) / 10 : 0, net: sum(r => r.delta),
      biggestWin: rows.reduce((m, r) => Math.max(m, r.delta), 0), biggestLoss: rows.reduce((m, r) => Math.min(m, r.delta), 0)
    };
    if (!full) return base;
    const by = (key) => { const o = {}; for (const r of rows) { const k = key(r); if (k == null) continue; const x = o[k] = o[k] || { games: 0, wins: 0, net: 0 }; x.games++; x.wins += r.won; x.net += r.delta; } return o; };
    const jst = ts => new Date(ts + 9 * 3600000).toISOString().slice(0, 10);
    const tables = by(r => r.table_id);
    const names = this.db.prepare(`SELECT id,name FROM tables_ WHERE id IN (${Object.keys(tables).map(() => '?').join(',') || 'NULL'})`).all(...Object.keys(tables).map(Number));
    const best = rows.filter(r => r.cat && r.showdown).sort((a, b) => Solo.cmp(Solo.evalHand(...nums(b.hand.split(' '))), Solo.evalHand(...nums(a.hand.split(' ')))))[0];
    return Object.assign(base, {
      showdowns: sd.length, showdownWins: sum(r => r.won, sd), foldWins: rows.filter(r => r.won && !r.showdown).length,
      foldRate: games ? Math.round(rows.filter(r => r.folded).length / games * 1000) / 10 : 0,
      oyaGames: sum(r => r.oya), oyaNet: sum(r => r.oya ? r.delta : 0), biggestPot: rows.reduce((m, r) => Math.max(m, r.pot), 0),
      hands: by(r => r.cat), daily: Object.entries(by(r => jst(r.ts))).map(([day, x]) => Object.assign({ day }, x)),
      tables: names.map(t => Object.assign({ id: t.id, name: t.name }, tables[t.id])).sort((a, b) => b.games - a.games).slice(0, 20),
      best: best ? { hand: best.hand, cat: best.cat, ts: best.ts, won: !!best.won } : null,
      odds: Solo.categoryProbabilities()   // 手役の出やすさ(理論値)。自分の内訳と比べるため
    });
  }
}
module.exports = { Stats, FREE_DAYS };
