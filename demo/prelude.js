/* 体験版の土台: Node専用の部品(SQLite・暗号・http)を、ブラウザの部品で置き換える。
   サーバーのプログラム本体(core/ledger/tables/index)は本物と同じものをそのまま使う。 */
(function () {
'use strict';
const hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => { const u = new Uint8Array(s.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return u; };
const withStr = u => { u.toString = function (enc) { return enc === 'hex' ? hex(this) : new TextDecoder().decode(this); }; return u; };
const cryptoShim = {
  randomBytes: n => withStr(crypto.getRandomValues(new Uint8Array(n))),
  randomInt(a, b) { if (b === undefined) { b = a; a = 0; } const r = new Uint32Array(1), span = b - a, lim = Math.floor(0x100000000 / span) * span; let x; do { crypto.getRandomValues(r); x = r[0]; } while (x >= lim); return a + (x % span); },
  createHash() { let s = ''; return { update(t) { s += t; return this; }, digest() { return Solo.sha256hex(s); } }; },
  // 体験版だけの簡易版(本番は scrypt)。ブラウザには同期の scrypt がないため
  scrypt(pw, salt, len, cb) { try { const k = this.scryptSync(pw, salt, len); setTimeout(() => cb(null, k), 0); } catch (e) { cb(e); } },
  scryptSync(pw, salt, len) { let h = pw + '|' + salt; for (let i = 0; i < 40; i++) h = Solo.sha256hex(h); return withStr(unhex(h).slice(0, len)); },
  timingSafeEqual(a, b) { if (a.length !== b.length) throw new RangeError('長さが違います'); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
};
window.Buffer = { from: (s, enc) => withStr(enc === 'hex' ? unhex(s) : new TextEncoder().encode(String(s))) };

function sqliteShim(sqlite3) {
  const bindOf = p => { const b = p.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return b.length ? b : undefined; };
  class DatabaseSync {
    constructor() { this.h = new sqlite3.oo1.DB(':memory:', 'c'); }
    exec(sql) { this.h.exec(sql); }
    prepare(sql) {
      const h = this.h;
      const rows = p => h.exec({ sql, bind: bindOf(p), rowMode: 'object', returnValue: 'resultRows' });
      return {
        run: (...p) => { h.exec({ sql, bind: bindOf(p) }); return { changes: h.changes(), lastInsertRowid: h.selectValue('SELECT last_insert_rowid()') }; },
        all: (...p) => rows(p),
        get: (...p) => rows(p)[0]
      };
    }
  }
  return { DatabaseSync };
}

const defs = window.__DEFS = {};   // build が各ファイルを登録する
const cache = {};
window.__sqlite3 = null;
function req(name) {
  if (name === 'node:crypto') return cryptoShim;
  if (name === 'node:sqlite') return sqliteShim(window.__sqlite3);
  if (name === 'node:http') return { createServer: () => ({ listen() {} }) };
  if (name === 'node:fs') return {};
  if (name === 'node:path') return { join: (...a) => a.join('/'), resolve: (...a) => a.join('/'), dirname: p => p, extname: () => '' };
  if (name === '../engine.js') return window.Solo;
  if (cache[name]) return cache[name].exports;
  const f = defs[name]; if (!f) throw new Error('部品が見つかりません: ' + name);
  const m = cache[name] = { exports: {} };
  f(m, m.exports, req, '/server'); return m.exports;
}
window.__require = req;
})();
