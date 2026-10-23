'use strict';
// 負荷・乱暴な操作のテスト: 6人がランダムに 着席/離席/移す/退席/再着席 しながら長時間まわし、台帳が一度も崩れないかを見る
const assert = require('node:assert');
const D = require('./db'); const { Core } = require('./core'); const { Tables } = require('./tables');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEC = Number(process.env.SOAK_SEC || 20);
(async () => {
  const d = D.open(':memory:'), c = new Core(d);
  const cid = c.bootstrap('kaito', 'password-1', '09000000001'); const me = c.user(cid);
  const mk = (by, role, name, i) => c.signup({ invite: c.createInvite(c.user(by), role).code, username: name, password: 'password-' + name, phone: '0900000' + (1000 + i), deviceId: 'device-' + name + '-xx', ip: '10.0.0.' + i, age18: true, agree: true }).id;
  const man = mk(cid, 'manager', 'kanri', 1), aj = mk(man, 'aj', 'aj_one', 2);
  c.give(c.user(cid), man, 10000000); c.give(c.user(man), aj, 5000000);
  const ps = []; for (let i = 0; i < 6; i++) { const id = mk(aj, 'player', 'play' + (i + 1), 10 + i); c.give(c.user(aj), id, 30000); ps.push(id); }
  let now = Date.parse('2026-10-13T10:00:00+09:00');
  const T = new Tables(c, { turnMs: 400, voteMs: 300, graceMs: 200, minStayMs: 0, disconnectGraceMs: 100, beatScale: 0, feeTickMs: 0, clock: () => now });
  const tabs = [T.get(T.create(c.user(aj), 'A', { seats: 6, ante: 100, minBet: 100, limit: 1000, leave: 'allow', lateJoin: 'allow' }).id), T.get(T.create(c.user(aj), 'B', { seats: 6, ante: 200, minBet: 100, limit: 2000, leave: 'allow', lateJoin: 'allow', upLimit: 300 }).id)];
  const bots = new Map();
  const decide = r => { const k = Math.random();
    if (r.type === 'carryJoin') return { act: k < .6 ? 'join' : 'skip' };
    if (r.type === 'oya') return k < .15 ? { act: 'fold' } : (k < .3 && r.canShow) ? { act: 'show' } : r.canBet ? { act: 'bet', amount: Math.max(r.minBet, Math.floor(r.cap * Math.random())) } : { act: 'fold' };
    if (r.type === 'biki') return { act: 'follow', up: r.upCap ? Math.floor(r.upCap * Math.random()) : 0 };
    return { act: k < .6 ? 'follow' : 'fold' };
  };
  const attach = (rt, uid) => {
    const b = { busy: false };
    b.res = { write: s => {
      if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6));
      if (v.req && !b.busy) { b.busy = true; setImmediate(() => { b.busy = false; try { rt.act(c.user(uid), decide(v.req)); } catch (e) {} }); }
    } };
    rt.subscribe(c.user(uid), b.res); bots.set(uid, { rt, b });
  };
  let ops = 0, errs = {}, games0 = 0;
  const chaos = async () => {
    const uid = ps[Math.floor(Math.random() * ps.length)], u = c.user(uid), rt = tabs[Math.floor(Math.random() * 2)], k = Math.random(), cur = c.db ? T.seatedAt(uid) : null;
    try {
      if (!cur) { if (k < .7) { await rt.join(u, 2000 + Math.floor(Math.random() * 6000)); attach(rt, uid); } }
      else { const r2 = T.get(cur);
        if (k < .15) r2.leave(u); else if (k < .3) r2.setAway(u, true); else if (k < .5) r2.setAway(u, false);
        else if (k < .7) r2.exchange(u, 'in', 100 + Math.floor(Math.random() * 3000)); else if (k < .85) r2.exchange(u, 'out', 100 + Math.floor(Math.random() * 3000)); else if (k < .9) c.give(c.user(aj), uid, 2000);
        if (T.seatedAt(uid) == null && bots.has(uid)) { bots.get(uid).rt.unsubscribe(u, bots.get(uid).b.res); bots.delete(uid); } }
      ops++;
    } catch (e) { errs[e.message.slice(0, 40)] = (errs[e.message.slice(0, 40)] || 0) + 1; }
  };
  const end = Date.now() + SEC * 1000; let bad = 0;
  while (Date.now() < end) {
    await chaos(); now += 7 * 60000; tabs.forEach(t => { try { t.feeTick(now); } catch (e) { console.error('feeTick', e); bad++; } });
    const chk = c.L.check(); if (!chk.ok) { console.error('台帳が崩れた', JSON.stringify(chk)); bad++; break; }
    for (const t of tabs) if (t.status === 'stopped') { console.error('卓が停止した', t.id); bad++; }
    if (bad) break; await sleep(15);
  }
  tabs.forEach(t => { try { T.stop(c.user(aj), t.id); } catch (e) {} });
  for (let k = 0; k < 150 && tabs.some(t => !['stopped', 'ended'].includes(t.status)); k++) await sleep(100);   // 動いている最中のゲームが終わるまで待つ
  await sleep(500);
  const fin = c.L.check(); const games = c.db.prepare('SELECT COUNT(*) n FROM games').get().n;
  const neg = c.db.prepare('SELECT acct,balance FROM accounts WHERE balance<0').all();
  console.log('ops', ops, 'games', games, 'ledger ok', fin.ok, 'negative accts', neg.length, 'expected errors', JSON.stringify(errs));
  const left = c.db.prepare("SELECT acct,balance FROM accounts WHERE (acct LIKE 's:%' OR acct LIKE 'p:%' OR acct LIKE 'j:%') AND balance<>0").all(); console.log('left in tables', JSON.stringify(left));
  assert.ok(fin.ok && !neg.length && !bad && !left.length); console.log('SOAK OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
