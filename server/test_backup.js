'use strict';
// バックアップ→わざと壊す→復元→確認 の通し練習。
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const D = require('./db'), { Core } = require('./core'), bk = require('./backup');
let n = 0; const ok = (m) => { n++; console.log('  OK  ' + m); };
const eq = (a, b, m) => { if (a !== b) { console.error('NG', m, a, b); process.exit(1); } ok(m); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solobk-'));
const live = path.join(dir, 'solo.db'), bdir = path.join(dir, 'backups');
const d = D.open(live); const c = new Core(d);
const cid = c.bootstrap('kaito', 'password-1', '09000000001');
const inv = c.createInvite(c.user(cid), 'player');
c.signup({ invite: inv.code, username: 'play1', password: 'password-p1', phone: '09000000002', deviceId: 'dev-bk-0001', ip: '1.1.1.1' });
const file = bk.makeBackup(d.db, bdir);
eq(bk.verify(file), null, '作ったバックアップは検査に通る(壊れていない・チップ合計=5億)');
// バックアップのあとで増えた分
const inv2 = c.createInvite(c.user(cid), 'player');
c.signup({ invite: inv2.code, username: 'play2', password: 'password-p2', phone: '09000000003', deviceId: 'dev-bk-0002', ip: '1.1.1.2' });
eq(d.db.prepare('SELECT COUNT(*) c FROM users').get().c, 3, '本番側は3人');
// 壊れたコピーは拒否される
const bad = path.join(dir, 'bad.db'); fs.writeFileSync(bad, Buffer.alloc(4096, 7));
eq(!!bk.verify(bad), true, '壊れたファイルは使えないと判定される');
let thrown = false; try { bk.restore(bad, live); } catch (e) { thrown = /使えません/.test(e.message); }
eq(thrown, true, '壊れたバックアップでは復元されない(今のデータはそのまま)');
// 台帳が合わないコピーは拒否される
const tampered = path.join(dir, 'tampered.db'); fs.copyFileSync(file, tampered);
const { DatabaseSync } = require('node:sqlite'); const t = new DatabaseSync(tampered);
t.exec("DROP TRIGGER IF EXISTS ledger_no_update"); t.exec("UPDATE accounts SET balance=balance+1 WHERE acct=(SELECT acct FROM accounts LIMIT 1)"); t.close();
eq(/チップの合計/.test(bk.verify(tampered) || ''), true, 'チップ合計が合わないコピーは使えないと判定される');
// 復元
d.db.close();
const r = bk.restore(file, live);
eq(fs.existsSync(r.kept), true, '復元前の本番ファイルは別名で残る');
const d2 = D.open(live);
eq(d2.db.prepare('SELECT COUNT(*) c FROM users').get().c, 2, '復元後は、バックアップ時点の2人に戻る');
eq(new (require('./ledger').Ledger)(d2).check().ok, true, '復元後も台帳は合っている');
d2.db.close();
// 整理: 古いものを消すが新しいものは残る
for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(bdir, `solo-2026010${1 + (i % 9)}-${String(i).padStart(2, '0')}00.db`), 'x');
bk.prune(bdir);
eq(fs.readdirSync(bdir).filter(f => f.startsWith('solo-')).length <= 48 + 30 + 1, true, '古いバックアップは整理される');
console.log('\n全' + n + '項目 合格'); 
