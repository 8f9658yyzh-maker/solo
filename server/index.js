'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db'); const { Core, Err, need } = require('./core'); const { Tables, DEFAULTS } = require('./tables'); const { Billing } = require('./billing');

function createApp(opts) {
  opts = opts || {};
  const d = D.open(opts.dbFile || ':memory:'), core = new Core(d, opts.core), tables = new Tables(core, opts.tables);
  const billing = new Billing(d, core, opts.billing);   // 有料プラン(鍵がなければ申し込みボタンを出さない)
  if (opts.recover !== false) { const n = tables.recover(); if (n) console.log(`[復旧] 中断していた卓${n}件のチップをポケットへ戻しました`); }
  const webDir = path.join(__dirname, '..', 'web');
  const trustProxy = !!opts.trustProxy;
  const hits = new Map();
  const tickets = new Map();   // 卓の中継(SSE)用の短い引換券。本物のログイン用の鍵をURLに載せないため
  const limited = (key, max, ms) => { const now = Date.now(); const a = (hits.get(key) || []).filter(t => t > now - ms); a.push(now); hits.set(key, a); return a.length > max; };
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

  const clientIp = req => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '';
  const readBody = req => new Promise((res, rej) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 100000) { rej(new Err('データが大きすぎます', 413)); req.destroy(); } });
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(new Err('JSONが正しくありません')); } });
  });
  const send = (res, code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(s); };

  async function api(req, res, url) {
    const m = req.method, p = url.pathname, q = url.searchParams;
    const ip = clientIp(req);
    let token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const tkq = q.get('ticket');
    if (!token && tkq) { const t = tickets.get(tkq); token = t && t.exp > Date.now() && p === `/api/tables/${t.tableId}/stream` ? t.token : ''; }
    // Stripe からの知らせ: ログイン不要・システム更新中でも受け取る(取りこぼすと、払った人がプランを使えなくなるため)
    if (m === 'POST' && p === '/api/stripe/webhook') {
      const raw = await new Promise((ok, ng) => { let b = ''; req.setEncoding('utf8'); req.on('data', c => { b += c; if (b.length > 500000) { ng(new Err('データが大きすぎます', 413)); req.destroy(); } }); req.on('end', () => ok(b)); });
      return send(res, 200, await billing.webhook(raw, req.headers['stripe-signature']));
    }
    let body = {}; if (m !== 'GET') body = await readBody(req);
    // ---- 認証なし ----
    if (m === 'POST' && p === '/api/signup') { need(body.age18 === true, '18歳以上であることへの同意が必要です'); need(!limited('su' + ip, 10, 600000), '登録の試行が多すぎます。しばらく待ってください', 429); return send(res, 200, await core.signupAsync(Object.assign({}, body, { ip }))); }
    if (m === 'POST' && p === '/api/login') { need(!limited('li' + ip, 20, 600000), 'ログインの試行が多すぎます。しばらく待ってください', 429); return send(res, 200, await core.loginAsync(Object.assign({}, body, { ip }))); }
    if (m === 'GET' && p === '/api/health') return send(res, 200, { ok: true, ledger: core.L.check().ok });
    const u = core.auth(token); need(u, 'ログインしてください', 401);
    const isTop = u.role === 'creator' || u.role === 'sovereign';
    if (p !== '/api/me' && !(m === 'GET' && p.endsWith('/stream')) && limited('rq' + u.id, 600, 60000)) throw new Err('操作が速すぎます。少し待ってください', 429);
    const mt = core.maintenance();
    if (mt.on && !isTop && !['/api/me', '/api/logout'].includes(p)) return send(res, 503, { error: 'システム更新中です。しばらくお待ちください', maintenance: true });
    let mm;
    if (m === 'POST' && p === '/api/logout') { core.logout(token); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/me') {
      const house = core.homeHouseId(u);
      return send(res, 200, { user: core.pub(u), pocket: core.pocket(u.id), homeHouse: house, houses: core.myHouses(u), seatedAt: tables.seatedAt(u.id) || null, unread: core.notifications(u).filter(n => !n.read).length, peek: core.peekBalance(u.id), plan: billing.status(u), adFree: billing.active(u.id), supply: isTop ? core.L.supply() : undefined, defaults: DEFAULTS, chatEnabled: tables.opt.chatEnabled, ads: !!tables.opt.ads, maintenance: mt.on ? { msg: mt.msg || '', ts: mt.ts } : null, maintNotice: !mt.on && mt.at > Date.now() ? { at: mt.at, msg: mt.msg || '' } : null, rules: { minUnit: tables.opt.minUnit, feeBp: tables.opt.feeBp, jackpotBp: tables.opt.jackpotBp, jpRank: tables.opt.jpRank, shugiMin: tables.opt.shugiMin, entryFee: tables.opt.entryFee, entryFirst: core.cfg.ENTRY_FEE_FIRST, entryNext: core.cfg.ENTRY_FEE_NEXT }, pass: tables.opt.entryFee ? (() => { const n = tables.opt.clock(), r = core.passRow(u.id, n); return { exempt: isTop, until: r.paid_until > n ? r.paid_until : 0, next: core.entryFeeNow(u.id, n), count: r.n }; })() : null });
    }
    // ---- 有料プラン ----
    if (m === 'GET' && p === '/api/plan') return send(res, 200, billing.status(u));
    if (m === 'POST' && p === '/api/plan/checkout') { need(!limited('co' + u.id, 5, 600000), '申し込みの操作が多すぎます。しばらく待ってください', 429); return send(res, 200, await billing.checkout(u)); }
    if (m === 'POST' && p === '/api/plan/portal') return send(res, 200, await billing.portal(u));
    if (m === 'GET' && p === '/api/admin/plans') return send(res, 200, billing.list(u));
    if (m === 'POST' && p === '/api/invites') return send(res, 200, core.createInvite(u, body.role));
    if (m === 'GET' && p === '/api/users') return send(res, 200, core.visibleUsers(u));
    if (m === 'POST' && p === '/api/maintenance') { const v = core.setMaintenance(u, body.on === true, body.msg, body.at); const stopped = v.on ? tables.stopAll() : 0; return send(res, 200, Object.assign({ stopped }, v)); }
    if (m === 'GET' && p === '/api/config') return send(res, 200, core.getConfig(u));
    if (m === 'POST' && p === '/api/config') return send(res, 200, core.setConfig(u, body.patch));
    if (m === 'GET' && p === '/api/requests') return send(res, 200, core.listRequests(u));
    if (m === 'POST' && p === '/api/requests') return send(res, 200, { id: core.addRequest(u, body.body) });
    { const rm = p.match(/^\/api\/requests\/(\d+)$/); if (m === 'POST' && rm) { core.setRequestStatus(u, Number(rm[1]), body.status); return send(res, 200, { ok: true }); } }
    if (m === 'GET' && p === '/api/fees') return send(res, 200, core.feeOverview(u));
    { const fm = p.match(/^\/api\/fees\/(\d+)\/receive$/); if (m === 'POST' && fm) return send(res, 200, core.feeReceive(u, Number(fm[1]))); }
    if (m === 'GET' && p === '/api/ledger') return send(res, 200, core.myLedger(u, 100));
    if (m === 'GET' && p === '/api/ledger/all') return send(res, 200, core.fullLedger(u, 300));
    if (m === 'POST' && p === '/api/give') return send(res, 200, core.give(u, Number(body.to), body.amount, body.note));
    if (m === 'POST' && p === '/api/pull') return send(res, 200, core.pull(u, Number(body.from), body.amount, body.note));
    if (m === 'POST' && p === '/api/supply') { need(u.role === 'creator', '総量を変えられるのは作成者だけです', 403); core.L.changeSupply(u.id, body.supply); return send(res, 200, { supply: core.L.supply(), check: core.L.check() }); }
    if (m === 'GET' && p === '/api/ledger/check') { need(isTop, '権限がありません', 403); return send(res, 200, core.L.check()); }
    // ---- ハウス ----
    if (m === 'GET' && p === '/api/house') { const pw = core.housePassword(u); return send(res, 200, Object.assign(pw, { members: core.houseMembers(u), tables: tables.list(pw.houseId), tableLimit: core.houseOf(u.id).table_limit })); }
    if (m === 'POST' && p === '/api/house/kick') return send(res, 200, { ok: core.kickFromHouse(u, Number(body.userId)) });
    if (m === 'POST' && p === '/api/houses/join') return send(res, 200, core.joinHouse(u, body.houseId, body.password));
    if (m === 'POST' && p === '/api/houses/leave') { core.leaveHouse(u, String(body.houseId)); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/houses') return send(res, 200, core.myHouses(u));
    if (m === 'GET' && p === '/api/tables') {
      const hid = q.get('houseId') || core.homeHouseId(u); need(hid, 'ハウスを選んでください');
      need(core.isMember(u.id, hid) || isTop, 'このハウスのメンバーではありません', 403);
      return send(res, 200, tables.list(hid));
    }
    if (m === 'GET' && p === '/api/admin/tables') { need(isTop, '権限がありません', 403); return send(res, 200, d.db.prepare("SELECT t.id FROM tables_ t WHERE status IN ('open','running') ORDER BY id").all().map(r => { const s = tables.summary(tables.get(r.id)); s.houseName = (d.db.prepare('SELECT name FROM houses WHERE id=?').get(s.houseId) || {}).name; return s; })); }
    if (m === 'POST' && p === '/api/tables') return send(res, 200, tables.create(u, body.name, body.settings));
    if (m === 'POST' && p === '/api/limit-requests') return send(res, 200, { id: core.requestLimit(u, body.reason) });
    if (m === 'GET' && p === '/api/limit-requests') return send(res, 200, core.listLimitRequests(u));
    if ((mm = p.match(/^\/api\/limit-requests\/(\d+)\/(forward|decide)$/)) && m === 'POST') {
      if (mm[2] === 'forward') core.forwardLimit(u, Number(mm[1])); else core.decideLimit(u, Number(mm[1]), body.newLimit, !!body.approve); return send(res, 200, { ok: true });
    }
    // ---- 卓 ----
    if ((mm = p.match(/^\/api\/tables\/(\d+)(?:\/(\w+))?$/))) {
      const id = Number(mm[1]), act = mm[2], rt = tables.get(id);
      if (m === 'PATCH' && !act) return send(res, 200, tables.updateSettings(u, id, body.name, body.settings));
      if (m === 'GET' && act === 'stream') {
        const seated = rt.seatOf(u.id) >= 0;
        if (!seated) { need(isTop && tables.seatedAt(u.id) == null, '着席していない人は、この卓を見られません(作成者・統括は着席していなければ見られます)', 403); d.audit(u.id, 'spectate', id); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n'); rt.subscribe(u, res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
        req.on('close', () => { clearInterval(ping); rt.unsubscribe(u, res); });
        return;
      }
      if (m === 'GET' && act === 'view') { need(rt.seatOf(u.id) >= 0 || (isTop && tables.seatedAt(u.id) == null), '権限がありません(着席中は、ほかの卓を見られません)', 403); return send(res, 200, rt.view(u.id)); }
      if (m === 'GET' && act === 'games') { need(rt.seatOf(u.id) >= 0 || isTop || tables.participated(id, u.id), '権限がありません', 403); return send(res, 200, tables.games(id)); }
      if (m === 'GET' && act === 'gamedata') return send(res, 200, tables.gameData(id, u));
      if (m === 'POST' && act === 'ticket') { for (const [k, t] of tickets) if (t.exp < Date.now()) tickets.delete(k); const k = D.rand(16); tickets.set(k, { token, tableId: id, exp: Date.now() + 120000 }); return send(res, 200, { ticket: k }); }
      if (m === 'POST' && act === 'join') return send(res, 200, await rt.join(u, body.buyIn));
      if (m === 'POST' && act === 'leave') return send(res, 200, rt.leave(u));
      if (m === 'POST' && act === 'act') { rt.act(u, body); return send(res, 200, { ok: true }); }
      if (m === 'POST' && act === 'away') { rt.setAway(u, !!body.away); return send(res, 200, { ok: true }); }
      if (m === 'POST' && act === 'peek') return send(res, 200, rt.peek(u, body.target));
      if (m === 'POST' && act === 'exchange') { rt.exchange(u, body.dir === 'in' ? 'in' : 'out', body.amount); return send(res, 200, { ok: true }); }
      if (m === 'POST' && act === 'say') { rt.say(u, body.body); return send(res, 200, { ok: true }); }
      if (m === 'POST' && act === 'vote') { rt.castVote(u, !!body.yes); return send(res, 200, { ok: true }); }
      if (m === 'POST' && act === 'stop') return send(res, 200, tables.stop(u, id));
      if (m === 'POST' && act === 'report') { need(rt.seatOf(u.id) >= 0, '着席している人だけが通報できます', 403); const st = rt.seats[Number(body.seat)]; need(st, '対象が見つかりません', 404); return send(res, 200, core.report(u, st.userId, id, body.reason)); }
    }
    // ---- 通報・管理 ----
    if (m === 'POST' && p === '/api/reports') { need(core.pocket !== null, ''); return send(res, 200, core.report(u, Number(body.target), body.tableId || null, body.reason)); }
    if (m === 'GET' && p === '/api/notifications') return send(res, 200, core.notifications(u));
    if (m === 'POST' && p === '/api/notifications/read') { core.markRead(u); return send(res, 200, { ok: true }); }
    if (m === 'POST' && p === '/api/admin/peek-grant') { const n = core.peekGrant(u, Number(body.userId), body.n, 'grant'); return send(res, 200, { count: n }); }
    if (m === 'GET' && p === '/api/admin/reports') return send(res, 200, core.adminReports(u));
    if (m === 'GET' && p === '/api/admin/watch') return send(res, 200, core.watchList(u));
    if (m === 'GET' && p === '/api/admin/shared') return send(res, 200, core.sharedDevices(u));
    if (m === 'GET' && p === '/api/admin/audit') return send(res, 200, core.auditLog(u, 300));
    if (m === 'GET' && p === '/api/admin/banned-ips') return send(res, 200, core.bannedIps(u));
    if (m === 'GET' && p === '/api/admin/suspicion') { need(['creator', 'sovereign', 'manager'].includes(u.role), '権限がありません', 403); return send(res, 200, d.db.prepare('SELECT u.id,u.username,COUNT(*) AS n,MAX(s.ts) AS last_ts,GROUP_CONCAT(DISTINCT s.kind) AS kinds FROM suspicion s JOIN users u ON u.id=s.user_id GROUP BY u.id ORDER BY n DESC').all()); }
    if (m === 'POST' && p === '/api/admin/expel') { core.expel(u, Number(body.userId), body.reason); return send(res, 200, { ok: true }); }
    if (m === 'POST' && p === '/api/admin/clear') { core.clearWatch(u, Number(body.userId)); return send(res, 200, { ok: true }); }
    if (m === 'POST' && p === '/api/admin/ip-permit') { core.permitIp(u, body.ip, body.username); return send(res, 200, { ok: true }); }
    throw new Err('見つかりません', 404);
  }

  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/engine.js') p = null;
    const file = p === null ? path.join(__dirname, '..', 'engine.js') : path.join(webDir, p === '/' ? 'index.html' : p);
    if (p !== null && !path.resolve(file).startsWith(path.resolve(webDir))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('見つかりません'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; media-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(buf);
    });
  }
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url);
    } catch (e) {
      if (!(e instanceof Err)) console.error('[error]', req.method, req.url, e);
      if (!res.headersSent) send(res, e instanceof Err ? e.code : 500, { error: e instanceof Err ? e.message : 'サーバーでエラーが起きました' });
      else try { res.end(); } catch (e2) {}
    }
  };
  const server = http.createServer(handler);
  const maintTick = () => { const m = core.maintenance(); if (!m.on && m.at && m.at <= Date.now()) { core.setMaintenance(null, true, m.msg, 0); tables.stopAll(); return true; } return false; };   // 予告の時刻になったら、自動でシステム更新中にする
  const mtimer = setInterval(() => { try { maintTick(); } catch (e) { console.error('maintTick', e); } }, (opts && opts.maintTickMs) || 15000); if (mtimer.unref) mtimer.unref();
  return { server, core, tables, d, handler, maintTick, billing };
}

if (require.main === module) {
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'solo.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const app = createApp({ dbFile: file, trustProxy: process.env.TRUST_PROXY === '1', tables: { chatEnabled: process.env.CHAT !== '0' }, billing: process.env });
  if (!app.billing.ready()) console.log('有料プラン: 鍵(STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / PUBLIC_URL)が未設定なので、申し込みボタンは出ません');
  else console.log('有料プラン: ' + (app.billing.testMode() ? 'テストモード(本物のお金は動きません)' : '★本番モード(本物のお金が動きます)'));
  if (!app.d.db.prepare("SELECT 1 FROM users WHERE role='creator'").get()) {
    const u = process.env.CREATOR_USER, pw = process.env.CREATOR_PASS, ph = process.env.CREATOR_PHONE;
    if (u && pw) { app.core.bootstrap(u, pw, ph); console.log('作成者アカウントを作成し、5億チップを発行しました'); }
    else console.log('作成者がまだいません。CREATOR_USER / CREATOR_PASS / CREATOR_PHONE を指定して起動してください');
  }
  // バックアップ: 起動時と1時間ごと(検査つき)。BACKUP_DIR は本番では別ボリューム/別の場所を推奨
  const bdir = process.env.BACKUP_DIR || path.join(path.dirname(file), 'backups');
  const bk = require('./backup');
  const runBackup = () => { try { const f = bk.makeBackup(app.d.db, bdir); bk.prune(bdir); console.log('バックアップ作成:', f); } catch (e) { console.error('★バックアップ失敗:', e.message); } };
  runBackup(); setInterval(runBackup, 3600000).unref();
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, () => console.log('ソロ: http://localhost:' + port));
}
module.exports = { createApp };
