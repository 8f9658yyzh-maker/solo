'use strict';
// データベース（SQLite）。台帳は追記専用: 更新・削除を禁止するトリガーを付けています。
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const SUPPLY_DEFAULT = 500000000;
const ROLES = { creator: 1, sovereign: 2, manager: 3, aj: 4, player: 5 };
const ROLE_JA = { creator: '作成者', sovereign: '統括責任者', manager: 'ゲーム管理責任者', aj: 'AJ', player: 'プレイヤー' };

function open(file) {
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('creator','sovereign','manager','aj','player')),
    parent_id INTEGER REFERENCES users(id),
    phone_hash TEXT UNIQUE, phone_verified INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','watch','banned')),
    status_note TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, ip TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_id TEXT NOT NULL, ip TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, UNIQUE(user_id,device_id,ip));
  CREATE INDEX IF NOT EXISTS dev_dev ON devices(device_id); CREATE INDEX IF NOT EXISTS dev_ip ON devices(ip);
  CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, created_by INTEGER NOT NULL, role TEXT NOT NULL, used_by INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS accounts(acct TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0));
  CREATE TABLE IF NOT EXISTS ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT, tx TEXT NOT NULL, ts INTEGER NOT NULL,
    acct TEXT NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL,
    actor_id INTEGER, counter TEXT, ref TEXT, note TEXT);
  CREATE INDEX IF NOT EXISTS led_acct ON ledger(acct); CREATE INDEX IF NOT EXISTS led_tx ON ledger(tx);
  CREATE TRIGGER IF NOT EXISTS led_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'台帳は書き換えできません'); END;
  CREATE TRIGGER IF NOT EXISTS led_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'台帳は削除できません'); END;
  CREATE TABLE IF NOT EXISTS houses(id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, join_pass TEXT, pass_exp INTEGER NOT NULL DEFAULT 0, table_limit INTEGER NOT NULL DEFAULT 6, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS house_members(house_id TEXT NOT NULL, user_id INTEGER NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY(house_id,user_id));
  CREATE TABLE IF NOT EXISTS join_attempts(user_id INTEGER NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tables_(id INTEGER PRIMARY KEY AUTOINCREMENT, house_id TEXT NOT NULL, name TEXT NOT NULL, settings TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', state TEXT, created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER);
  CREATE TABLE IF NOT EXISTS games(id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL, no INTEGER NOT NULL, ts INTEGER NOT NULL, color TEXT, hash TEXT, commit_str TEXT, how TEXT, winner TEXT, result TEXT, data TEXT);
  CREATE TABLE IF NOT EXISTS chat(id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL, target_id INTEGER NOT NULL, table_id INTEGER, reason TEXT, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS suspicion(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, to_user INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS banned_ips(ip TEXT PRIMARY KEY, user_id INTEGER, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ip_permits(id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE, granted_by INTEGER NOT NULL, ts INTEGER NOT NULL, UNIQUE(ip,username));
  CREATE TABLE IF NOT EXISTS limit_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, aj_id INTEGER NOT NULL, reason TEXT, stage TEXT NOT NULL DEFAULT 'manager', status TEXT NOT NULL DEFAULT 'open', new_limit INTEGER, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS fee_log(id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL, user_id INTEGER, kind TEXT NOT NULL, amount INTEGER NOT NULL, ts INTEGER NOT NULL, note TEXT);
  CREATE TABLE IF NOT EXISTS change_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT '未', ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS peek_tickets(user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0 CHECK(n>=0));
  CREATE TABLE IF NOT EXISTS peek_log(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS passes(user_id INTEGER PRIMARY KEY, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, paid_until INTEGER NOT NULL DEFAULT 0, warned_for INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS pw_resets(code TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor_id INTEGER, action TEXT NOT NULL, target TEXT, detail TEXT);
  `);
  try { db.exec('ALTER TABLE games ADD COLUMN data TEXT'); } catch (e) { /* すでにある */ }
  try { db.exec('ALTER TABLE change_requests ADD COLUMN images TEXT'); } catch (e) { /* すでにある */ }   // 変更の要望に付ける写真(JSONの配列)
  const getMeta = (k, d) => { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : d; };
  const setMeta = (k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
  let depth = 0;
  function tx(fn) {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
    finally { depth--; }
  }
  const audit = (actor, action, target, detail) => db.prepare('INSERT INTO audit(ts,actor_id,action,target,detail) VALUES(?,?,?,?,?)').run(Date.now(), actor || null, action, target == null ? null : String(target), detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)));
  return { db, getMeta, setMeta, tx, audit };
}

const rand = (n) => crypto.randomBytes(n).toString('hex');
const randDigits = (n) => { let s = ''; while (s.length < n) s += crypto.randomInt(0, 10); return s; };

module.exports = { open, SUPPLY_DEFAULT, ROLES, ROLE_JA, rand, randDigits };
