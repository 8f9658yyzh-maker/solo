'use strict';
// バックアップ: 動いているデータベースから、整合性の取れたコピーを作る(VACUUM INTO)。
// 復元: コピーを検査(壊れていない・チップ合計が5億と一致)してから戻す。
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Ledger } = require('./ledger');

const stamp = (d = new Date()) => { const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`; };

// コピーが使えるか検査する。問題があれば文字列、なければ null。
function verify(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const ic = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(ic)[0] !== 'ok') return 'データベースが壊れています';
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name='accounts'").get();
    if (!has) return '台帳がありません';
    const c = new Ledger({ db, getMeta: (k, d) => { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : d; } }).check();
    if (!c.ok) return `チップの合計が合いません(口座${c.accounts}/記録${c.ledger}/発行${c.supply}/マイナス${c.negative})`;
    return null;
  } catch (e) { return String(e.message || e); } finally { try { db && db.close(); } catch (_) {} }
}

// 1回分を作る。作った直後に検査し、だめなら消して例外にする。
function makeBackup(liveDb, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `solo-${stamp()}.db`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  liveDb.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const bad = verify(out);
  if (bad) { try { fs.unlinkSync(out); } catch (_) {} throw new Error('バックアップの検査に失敗: ' + bad); }
  return out;
}

// 古いものを整理: 直近48個は全部残し、それより古いものは1日1個だけ、最大30日分。
function prune(dir, now = Date.now()) {
  const files = fs.readdirSync(dir).filter(f => /^solo-\d{8}-\d{4}\.db$/.test(f)).sort().reverse();
  const keep = new Set(files.slice(0, 48)); const days = new Set();
  for (const f of files.slice(48)) { const day = f.slice(5, 13); if (days.size < 30 && !days.has(day)) { days.add(day); keep.add(f); } }
  const removed = [];
  for (const f of files) if (!keep.has(f)) { fs.unlinkSync(path.join(dir, f)); removed.push(f); }
  return removed;
}

// 復元: 検査に通ったときだけ、今のファイルを退避してから置き換える。
function restore(backupFile, liveFile) {
  const bad = verify(backupFile);
  if (bad) throw new Error('このバックアップは使えません: ' + bad);
  let moved = null;
  if (fs.existsSync(liveFile)) { moved = liveFile + '.before-restore-' + stamp(); fs.renameSync(liveFile, moved); }
  for (const x of ['-wal', '-shm']) if (fs.existsSync(liveFile + x)) fs.renameSync(liveFile + x, (moved || liveFile) + x);
  fs.copyFileSync(backupFile, liveFile);
  return { restored: liveFile, kept: moved };
}

module.exports = { makeBackup, prune, restore, verify, stamp };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'verify' && a) { const r = verify(a); console.log(r ? 'NG: ' + r : 'OK: 使えるバックアップです'); process.exit(r ? 1 : 0); }
  else if (cmd === 'restore' && a && b) { console.log(JSON.stringify(restore(a, b))); }
  else console.log('使い方: node server/backup.js verify <バックアップ> / restore <バックアップ> <戻し先のdb>  (restoreはサーバーを止めてから)');
}
