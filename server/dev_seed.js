'use strict';
// 動作確認用: テスト用のアカウントと卓を用意して起動する(本番では使わない)
const { createApp } = require('./index');
const port = Number(process.env.PORT || 8099);
const app = createApp({ tables: { beatScale: Number(process.env.BEAT || 0.15), turnMs: 30000, graceMs: 20000, minStayMs: 2000, disconnectGraceMs: 4000 } });
const c = app.core;
const cid = c.bootstrap('kaito', 'password-1', '09000000001'); const me = c.user(cid);
const mk = (by, role, name, i) => c.signup({ invite: c.createInvite(c.user(by), role).code, username: name, password: 'password-1', phone: '0900000' + (3000 + i), deviceId: 'seed-' + name + '-device', ip: '10.1.0.' + i }).id;
const sov = mk(cid, 'sovereign', 'touhatsu', 1), man = mk(sov, 'manager', 'kanri', 2), aj = mk(man, 'aj', 'aj_one', 3);
c.give(c.user(sov), man, 50000000); c.give(c.user(man), aj, 5000000);
const names = ['yui', 'ken', 'mina', 'riku'];
names.forEach((n, i) => { const id = mk(aj, 'player', n + '_p', 10 + i); c.give(c.user(aj), id, 300000); });
const t = app.tables.create(c.user(aj), 'テーブル1', { seats: 6, ante: 100, minBet: 100, limit: 1000, lateJoin: 'allow' });
const t2 = app.tables.create(c.user(aj), '条件卓(2人)', { seats: 6, startMode: 'condition', chips: 20000, minPlayers: 2, endZero: 1, ante: 100, minBet: 100, limit: 2000 });
const t3 = app.tables.create(c.user(aj), '時間卓(1分)', { seats: 6, ante: 100, minBet: 100, limit: 1000, durationMin: 1, lateJoin: 'allow' });
app.server.listen(port, '127.0.0.1', () => console.log('READY ' + port + ' table=' + t.id));
