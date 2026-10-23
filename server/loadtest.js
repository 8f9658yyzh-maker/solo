'use strict';
const D = require('./db'); const { Core } = require('./core'); const { Tables } = require('./tables');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N = Number(process.env.N || 100), SEC = Number(process.env.SEC || 20), PER = 6;
(async () => {
  const d = D.open(process.env.DB || '/tmp/claude-0/load.db'), c = new Core(d);
  const cid = c.bootstrap('kaito', 'password-1', '09000000001');
  const mk = (by, role, name, i) => c.signup({ invite: c.createInvite(c.user(by), role).code, username: name, password: 'password-' + name, phone: '090' + String(10000000 + i), deviceId: 'device-' + name + '-xx', ip: '10.0.' + (i >> 8) + '.' + (i & 255), age18: true, agree: true }).id;
  const man = mk(cid, 'manager', 'kanri', 1), aj = mk(man, 'aj', 'aj_one', 2);
  c.give(c.user(cid), man, 200000000); c.give(c.user(man), aj, 150000000);
  const t0 = Date.now(), ps = []; for (let i = 0; i < N; i++) { const id = mk(aj, 'player', 'play' + i, 10 + i); c.give(c.user(aj), id, 20000); ps.push(id); }
  console.log('登録', N, '人', Date.now() - t0, 'ms');
  const T = new Tables(c, { turnMs: 15000, voteMs: 2000, graceMs: 200, minStayMs: 0, disconnectGraceMs: 1000, beatScale: 1, feeTickMs: 0 });
  T.opt.jackpotBp = 200; c.db.prepare('UPDATE houses SET table_limit=100000').run();
  let bytes = 0, msgs = 0, games = 0;
  const decide = r => { const k = Math.random();
    if (r.type === 'carryJoin') return { act: 'join' };
    if (r.type === 'oya') return k < .2 ? { act: 'fold' } : r.canBet ? { act: 'bet', amount: Math.max(r.minBet, Math.floor(r.cap * Math.random())) } : { act: 'fold' };
    if (r.type === 'biki') return { act: 'follow', up: 0 };
    return { act: k < .6 ? 'follow' : 'fold' }; };
  const nt = Math.ceil(N / PER), tabs = [];
  for (let t = 0; t < nt; t++) { const rt = T.get(T.create(c.user(aj), 'T' + t, { seats: PER, ante: 100, minBet: 100, limit: 500, startMode: 'free', shugiMul: 1 }).id); tabs.push(rt); }
  for (let i = 0; i < N; i++) { const rt = tabs[i % nt], uid = ps[i]; await rt.join(c.user(uid), 5000);
    const b = { busy: false }; b.res = { write: s => { bytes += s.length; msgs++; if (!s.startsWith('data: ')) return; const v = JSON.parse(s.slice(6));
      if (v.req && !b.busy) { b.busy = true; setTimeout(() => { b.busy = false; try { rt.act(c.user(uid), decide(v.req)); } catch (e) {} }, 800 + Math.random() * 1500); } } };
    rt.subscribe(c.user(uid), b.res); }
  const cpu0 = process.cpuUsage(), w0 = Date.now(), g0 = tabs.reduce((a, t) => a + t.T.gameNo, 0); let lagMax = 0, lagSum = 0, lagN = 0, last = Date.now();
  const lt = setInterval(() => { const n = Date.now(), l = Math.max(0, n - last - 50); last = n; lagMax = Math.max(lagMax, l); lagSum += l; lagN++; }, 50);
  await sleep(SEC * 1000); clearInterval(lt);
  const cpu = process.cpuUsage(cpu0), wall = Date.now() - w0, g1 = tabs.reduce((a, t) => a + t.T.gameNo, 0), m = process.memoryUsage();
  console.log(JSON.stringify({ N, tables: nt, sec: wall / 1000, games: g1 - g0, gamesPerSec: +((g1 - g0) / (wall / 1000)).toFixed(1), cpuPct: +(((cpu.user + cpu.system) / 1000) / wall * 100).toFixed(1), rssMB: Math.round(m.rss / 1e6), heapMB: Math.round(m.heapUsed / 1e6), sendKBperSec: Math.round(bytes / 1024 / (wall / 1000)), msgsPerSec: Math.round(msgs / (wall / 1000)), lagAvgMs: +(lagSum / lagN).toFixed(1), lagMaxMs: lagMax, ledgerOk: c.L.check().ok }));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
