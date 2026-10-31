'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db'); const { Core, Err, need } = require('./core'); const { Tables, DEFAULTS } = require('./tables'); const { Billing } = require('./billing');
const { Stats } = require('./stats'); const { Perks } = require('./perks'); const { Ads } = require('./ads'); const { ChipRequests } = require('./chipreq'); const { Legal } = require('./legal');

function createApp(opts) {
  opts = opts || {};
  const d = D.open(opts.dbFile || ':memory:'), core = new Core(d, opts.core), tables = new Tables(core, opts.tables);
  const billing = new Billing(d, core, opts.billing);   // 有料プラン(鍵がなければ申し込みボタンを出さない)
  const perks = billing.perks = new Perks(d, core, billing);   // 有料の特典(テーマ・単品の購入)
  const stats = new Stats(d, core, billing); core.onGame = (tid, rec) => stats.record(tid, rec);   // 戦績
  const ads = new Ads(d, core, billing, opts.ads || opts.billing);   // 広告(地元スポンサー・広告会社)
  const chipreq = new ChipRequests(d, core);   // チップの申請(AJ・管理責任者 → 上の立場)
  const legal = new Legal(d, core, opts.legal || opts.billing);   // 利用規約などのページと同意
  if (opts.recover !== false) { const n = tables.recover(); if (n) console.log(`[復旧] 中断していた卓${n}件のチップをポケットへ戻しました`); }
  const webDir = path.join(__dirname, '..', 'web');
  const trustProxy = !!opts.trustProxy;
  const setupCode = String(opts.setupCode || '').length >= 8 ? String(opts.setupCode) : '';   // 8文字未満の合言葉は使わない(当てられやすいため)
  const hits = new Map();
  const tickets = new Map();   // 卓の中継(SSE)用の短い引換券。本物のログイン用の鍵をURLに載せないため
  const limited = (key, max, ms) => { const now = Date.now(); const a = (hits.get(key) || []).filter(t => t > now - ms); a.push(now); hits.set(key, a); return a.length > max; };
  const MIME = { '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

  // 中継の後ろでは、中継が書いた値だけを信じる。X-Forwarded-For の先頭は利用者が自由に書けるので使わない(使うとIPの締め出し・回数制限をすり抜けられる)
  const clientIp = req => {
    if (trustProxy) {
      if (req.headers['fly-client-ip']) return String(req.headers['fly-client-ip']).trim();
      if (req.headers['x-forwarded-for']) { const a = String(req.headers['x-forwarded-for']).split(',').map(x => x.trim()).filter(Boolean); if (a.length) return a[a.length - 1]; }
    }
    return req.socket.remoteAddress || '';
  };
  // ---- 健康診断(見張りプログラムが5分ごとに見る) ----
  const mon = { errors500: [], uncaught: 0, lastBackupOk: opts.lastBackupOk || null, lastBackupError: null, backupSameDisk: false, dataDir: opts.dataDir || null };
  const recent = (arr, ms, now) => arr.filter(t => t > now - ms).length;
  let healthCache = null;
  function health(now = Date.now()) {
    if (healthCache && healthCache.at > now - 15000) return healthCache.body;   // 15秒は同じ答え(何度も開かれても台帳の検査を繰り返さない)
    const c = core.L.check(), alarm = [], warn = [];
    if (!c.ok) alarm.push('ledger');   // チップの合計が発行量と合わない・マイナスの口座がある
    const e500 = recent(mon.errors500, 600000, now); if (e500 >= 10) alarm.push('errors500'); else if (e500 > 0) warn.push('errors500');
    const te = recent(tables.tableErrors, 3600000, now); if (te >= 3) alarm.push('tableErrors'); else if (te > 0) warn.push('tableErrors');
    const stuck = tables.stalled(Math.max(tables.opt.graceMs, tables.opt.turnMs) + 120000, now); if (stuck) alarm.push('stalledTables');
    if (mon.uncaught) alarm.push('uncaught');
    let backupAgeMin = null;
    if (mon.lastBackupOk != null) { backupAgeMin = Math.floor((now - mon.lastBackupOk) / 60000); if (backupAgeMin > 360) alarm.push('backup'); else if (backupAgeMin > 120) warn.push('backup'); }
    else if (mon.lastBackupError) alarm.push('backup');
    if (mon.backupSameDisk) warn.push('backupSameDisk');
    let diskFreePct = null;
    if (mon.dataDir) { try { const f = fs.statfsSync(mon.dataDir); diskFreePct = Math.floor(f.bavail / f.blocks * 100); if (diskFreePct < 10) alarm.push('disk'); else if (diskFreePct < 20) warn.push('disk'); } catch (e) {} }
    const body = { ok: true, ledger: c.ok, level: alarm.length ? 'alarm' : warn.length ? 'warn' : 'ok', alarm, warn,
      errors500_10m: e500, tableErrors_1h: te, stalledTables: stuck, uncaught: mon.uncaught, backupAgeMin, diskFreePct, upMin: Math.floor(process.uptime() / 60) };
    healthCache = { at: now, body }; return body;
  }
  const readBody = (req, max = 100000) => new Promise((res, rej) => {
    // 上限を超えたら読むのをやめて「大きすぎます」と返す。すぐ切ると利用者には通信エラーに見えるので、上限の5倍までは読み捨ててから返す
    let b = '', got = 0, over = false;
    req.on('data', c => { got += c.length; if (over) { if (got > max * 5) req.destroy(); return; } b += c; if (b.length > max) { over = true; b = ''; rej(new Err('データが大きすぎます', 413)); } });
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
    // 写真を送る所(変更の要望・スポンサーの広告)だけ、大きめのデータを受け取る。ほかは 100KB まで
    let body = {}; if (m !== 'GET') body = await readBody(req, p === '/api/requests' || p.startsWith('/api/admin/sponsors') ? 1500000 : 100000);
    // ---- 認証なし ----
    if (m === 'POST' && p === '/api/signup') { need(body.age18 === true, '18歳以上であることへの同意が必要です'); need(!limited('su' + ip, 10, 600000), '登録の試行が多すぎます。しばらく待ってください', 429); return send(res, 200, await core.signupAsync(Object.assign({}, body, { ip }))); }
    if (m === 'POST' && p === '/api/password/reset') { need(!limited('pr' + ip, 10, 600000), '試行が多すぎます。しばらく待ってください', 429); return send(res, 200, await core.resetPasswordAsync(body)); }
    if (m === 'POST' && p === '/api/login') { need(!limited('li' + ip, 20, 600000), 'ログインの試行が多すぎます。しばらく待ってください', 429); return send(res, 200, await core.loginAsync(Object.assign({}, body, { ip }))); }
    if (m === 'GET' && p === '/api/health') return send(res, 200, health());
    // 最初の設定: 作成者がまだいないときだけ、合言葉(SETUP_CODE)を知っている人が作成者を作れる。パスワードをサーバーの設定やチャットに書かずに済む
    if (p === '/api/setup') {
      const done = !!d.db.prepare("SELECT 1 FROM users WHERE role='creator'").get(), open = !!setupCode && !done;
      if (m === 'GET') return send(res, 200, { needed: open, done, code: !!setupCode });   // 受け付けない理由が分かるように(作成者がいる / 合言葉がない・8文字未満)
      need(open, done ? '最初の設定は、もう終わっています(作成者がいます)' : '合言葉が設定されていないか、8文字より短いため、最初の設定は使えません', 400);
      need(!limited('setup' + ip, 5, 600000), '試行が多すぎます。10分ほど待ってください', 429);
      const a = Buffer.from(String(body.code || '')), b = Buffer.from(setupCode);
      need(a.length === b.length && require('node:crypto').timingSafeEqual(a, b), '合言葉が違います', 403);
      const id = core.bootstrap(String(body.username || ''), String(body.password || ''), String(body.phone || ''));
      d.audit(id, 'setup', id, { ip });
      return send(res, 200, { ok: true });
    }
    const u = core.auth(token); need(u, 'ログインしてください', 401);
    const isTop = u.role === 'creator' || u.role === 'sovereign';
    if (p !== '/api/me' && !(m === 'GET' && p.endsWith('/stream')) && limited('rq' + u.id, 600, 60000)) throw new Err('操作が速すぎます。少し待ってください', 429);
    const mt = core.maintenance();
    if (mt.on && !isTop && !['/api/me', '/api/logout'].includes(p)) return send(res, 503, { error: 'システム更新中です。しばらくお待ちください', maintenance: true });
    let mm;
    if (m === 'POST' && p === '/api/logout') { core.logout(token); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/me') {
      const house = core.homeHouseId(u);
      return send(res, 200, { user: core.pub(u), pocket: core.pocket(u.id), homeHouse: house, houses: core.myHouses(u), seatedAt: tables.seatedAt(u.id) || null, unread: core.notifications(u).filter(n => !n.read).length, peek: core.peekBalance(u.id), plan: billing.status(u), adFree: billing.active(u.id), perks: perks.status(u), ad: ads.config(u), terms: { need: legal.need(u), ver: legal.version() }, supply: isTop ? core.L.supply() : undefined, defaults: DEFAULTS, chatEnabled: tables.opt.chatEnabled, ads: !!tables.opt.ads, maintenance: mt.on ? { msg: mt.msg || '', ts: mt.ts } : null, maintNotice: !mt.on && mt.at > Date.now() ? { at: mt.at, msg: mt.msg || '' } : null, rules: { minUnit: tables.opt.minUnit, feeBp: tables.opt.feeBp, jackpotBp: tables.opt.jackpotBp, jpRank: tables.opt.jpRank, shugiMin: tables.opt.shugiMin, entryFee: tables.opt.entryFee, entryFirst: core.cfg.ENTRY_FEE_FIRST, entryNext: core.cfg.ENTRY_FEE_NEXT }, pass: tables.opt.entryFee ? (() => { const n = tables.opt.clock(), r = core.passRow(u.id, n); return { exempt: isTop, until: r.paid_until > n ? r.paid_until : 0, next: core.entryFeeNow(u.id, n), count: r.n }; })() : null });
    }
    // ---- 有料プラン ----
    if (m === 'GET' && p === '/api/plan') return send(res, 200, billing.status(u));
    if (m === 'POST' && p === '/api/plan/checkout') { need(!limited('co' + u.id, 5, 600000), '申し込みの操作が多すぎます。しばらく待ってください', 429); return send(res, 200, await billing.checkout(u)); }
    if (m === 'POST' && p === '/api/plan/portal') return send(res, 200, await billing.portal(u));
    if (m === 'GET' && p === '/api/admin/plans') return send(res, 200, billing.list(u));
    // ---- 特典(戦績・テーマ・単品) ----
    if (m === 'GET' && p === '/api/stats') return send(res, 200, stats.mine(u, q.get('days')));
    if (m === 'POST' && p === '/api/prefs') return send(res, 200, perks.setTheme(u, String(body.theme || '')));
    if (m === 'POST' && p === '/api/shop/buy') { need(!limited('co' + u.id, 5, 600000), '申し込みの操作が多すぎます。しばらく待ってください', 429); return send(res, 200, await billing.buy(u, body.item)); }
    if (m === 'GET' && p === '/api/admin/sales') return send(res, 200, perks.sales(u));
    if (m === 'POST' && p === '/api/terms/agree') return send(res, 200, legal.agree(u, String(body.ver || '')));
    // ---- 広告 ----
    if (m === 'GET' && p === '/api/ads/pick') return send(res, 200, ads.pick(u, q.get('slot')));
    if (m === 'POST' && p === '/api/ads/click') { need(!limited('ac' + u.id, 30, 600000), '操作が多すぎます', 429); return send(res, 200, ads.click(u, body.id)); }
    if (m === 'GET' && p === '/api/admin/sponsors') return send(res, 200, ads.list(u));
    if (m === 'POST' && p === '/api/admin/sponsors') return send(res, 200, ads.create(u, body));
    if ((mm = p.match(/^\/api\/admin\/sponsors\/(\d+)(\/image)?$/))) { if (m === 'PATCH' && !mm[2]) return send(res, 200, ads.update(u, Number(mm[1]), body)); if (m === 'GET' && mm[2]) return send(res, 200, ads.image(u, Number(mm[1]))); }
    // ---- チップの申請 ----
    if (m === 'GET' && p === '/api/chip-requests') return send(res, 200, chipreq.list(u));
    if (m === 'POST' && p === '/api/chip-requests') { need(!limited('cr' + u.id, 10, 3600000), '申請が多すぎます。しばらく待ってください', 429); return send(res, 200, chipreq.create(u, body.amount, body.note)); }
    if ((mm = p.match(/^\/api\/chip-requests\/(\d+)\/(approve|decline|cancel)$/)) && m === 'POST') return send(res, 200, mm[2] === 'cancel' ? chipreq.cancel(u, Number(mm[1])) : chipreq.decide(u, Number(mm[1]), mm[2] === 'approve', body.reply));
    if (m === 'POST' && p === '/api/invites') return send(res, 200, core.createInvite(u, body.role));
    if (m === 'POST' && p === '/api/password-resets') { need(!limited('prc' + u.id, 20, 3600000), '操作が多すぎます', 429); return send(res, 200, core.createReset(u, body.userId)); }
    if (m === 'GET' && p === '/api/users') return send(res, 200, core.visibleUsers(u));
    if (m === 'POST' && p === '/api/maintenance') { const v = core.setMaintenance(u, body.on === true, body.msg, body.at); const stopped = v.on ? tables.stopAll() : 0; return send(res, 200, Object.assign({ stopped }, v)); }
    if (m === 'GET' && p === '/api/config') return send(res, 200, core.getConfig(u));
    if (m === 'POST' && p === '/api/config') return send(res, 200, core.setConfig(u, body.patch));
    if (m === 'GET' && p === '/api/requests') return send(res, 200, core.listRequests(u));
    if (m === 'POST' && p === '/api/requests') return send(res, 200, { id: core.addRequest(u, body.body, body.images) });
    { const rm = p.match(/^\/api\/requests\/(\d+)$/); if (m === 'POST' && rm) { core.setRequestStatus(u, Number(rm[1]), body.status); return send(res, 200, { ok: true }); } }
    { const rm = p.match(/^\/api\/requests\/(\d+)\/images$/); if (m === 'GET' && rm) return send(res, 200, core.requestImages(u, Number(rm[1]))); }
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
      if (m === 'POST' && act === 'join') return send(res, 200, await rt.join(u, body.buyIn));   // 規約が変わっても、遊ぶのを止めない(変更はお知らせで伝える)
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

  // 画面の安全の決まり(CSP)。広告会社を使うときだけ、Google の広告の読み込み先を足す
  const NET = 'https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com https://*.adtrafficquality.google https://*.googleadservices.com';
  const csp = () => ads.net()
    ? `default-src 'self'; media-src 'self' blob: data:; script-src 'self' ${NET}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' ${NET}; frame-src ${NET}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
    : "default-src 'self'; media-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  const headers = type => ({ 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': ads.net() ? 'strict-origin-when-cross-origin' : 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': csp() });
  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/ads.txt') { const t = ads.adsTxt(); res.writeHead(t ? 200 : 404, headers(MIME['.txt'])); return res.end(t || ''); }
    { const lm = p.match(/^\/legal\/([a-z]+)(?:\.html)?$/); if (lm) {   // 規約などのページ(運営者・販売者の情報を差し込む)
      return fs.readFile(path.join(webDir, 'legal', lm[1] + '.html'), 'utf8', (err, tpl) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('見つかりません'); }
        let out; try { out = legal.render(lm[1], tpl); } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('見つかりません'); }
        res.writeHead(200, headers(MIME['.html'])); res.end(out);
      });
    } }
    if (p === '/engine.js') p = null;
    const file = p === null ? path.join(__dirname, '..', 'engine.js') : path.join(webDir, p === '/' ? 'index.html' : p);
    if (p !== null && !path.resolve(file).startsWith(path.resolve(webDir))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('見つかりません'); }
      res.writeHead(200, headers(MIME[path.extname(file)] || 'application/octet-stream'));
      res.end(buf);
    });
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url);
    } catch (e) {
      if (!(e instanceof Err)) { console.error('[error]', req.method, req.url, e); mon.errors500.push(Date.now()); if (mon.errors500.length > 1000) mon.errors500.shift(); }
      if (!res.headersSent) send(res, e instanceof Err ? e.code : 500, { error: e instanceof Err ? e.message : 'サーバーでエラーが起きました' });
      else try { res.end(); } catch (e2) {}
    }
  };
  const server = http.createServer(handler);
  const maintTick = () => { const m = core.maintenance(); if (!m.on && m.at && m.at <= Date.now()) { core.setMaintenance(null, true, m.msg, 0); tables.stopAll(); return true; } return false; };   // 予告の時刻になったら、自動でシステム更新中にする
  const mtimer = setInterval(() => { try { maintTick(); } catch (e) { console.error('maintTick', e); } }, (opts && opts.maintTickMs) || 15000); if (mtimer.unref) mtimer.unref();
  // 片付け: 回数制限の記録と、期限切れのログインを消す(長く動かすと、たまり続けてメモリ・ファイルが大きくなるため)
  const tidy = (now = Date.now()) => {
    for (const [k, a] of hits) if (!a.length || a[a.length - 1] < now - 600000) hits.delete(k);
    for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
    return d.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now).changes;
  };
  const ttimer = setInterval(() => { try { tidy(); } catch (e) { console.error('tidy', e); } }, 600000); if (ttimer.unref) ttimer.unref();
  return { server, core, tables, d, handler, maintTick, billing, health, mon, tidy, hits, perks, stats, ads, chipreq, legal };
}

if (require.main === module) {
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'solo.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const app = createApp({ dbFile: file, dataDir: path.dirname(file), trustProxy: process.env.TRUST_PROXY === '1', setupCode: process.env.SETUP_CODE, tables: { chatEnabled: process.env.CHAT !== '0' }, billing: process.env });
  if (!app.billing.ready()) console.log('有料プラン: 鍵(STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / PUBLIC_URL)が未設定なので、申し込みボタンは出ません');
  else console.log('有料プラン: ' + (app.billing.testMode() ? 'テストモード(本物のお金は動きません)' : '★本番モード(本物のお金が動きます)'));
  console.log('広告: ' + (app.ads.client ? '地元スポンサー + Google AdSense(設定の「広告会社」を1にすると出ます)' : '地元スポンサーだけ(ADSENSE_CLIENT が未設定)'));
  { const miss = ['LEGAL_OPERATOR', 'LEGAL_CONTACT'].concat(app.billing.ready() ? ['SELLER_NAME', 'SELLER_ADDRESS', 'SELLER_PHONE'] : []).filter(k => !process.env[k]); if (miss.length) console.log('注意: 規約などのページに【未記入】があります: ' + miss.join(', ')); }
  if (!app.d.db.prepare("SELECT 1 FROM users WHERE role='creator'").get()) {
    const u = process.env.CREATOR_USER, pw = process.env.CREATOR_PASS, ph = process.env.CREATOR_PHONE;
    if (u && pw) { app.core.bootstrap(u, pw, ph); console.log('作成者アカウントを作成し、5億チップを発行しました'); }
    else if (process.env.SETUP_CODE) console.log('作成者がまだいません。画面の「最初の設定」から、合言葉(SETUP_CODE)を使って作ってください');
    else console.log('作成者がまだいません。SETUP_CODE(画面から作る)か、CREATOR_USER / CREATOR_PASS / CREATOR_PHONE を指定して起動してください');
  }
  // バックアップ: 起動時と1時間ごと(検査つき)。BACKUP_DIR は本番では別ボリューム/別の場所を推奨
  const bdir = process.env.BACKUP_DIR || path.join(path.dirname(file), 'backups');
  const bk = require('./backup');
  const runBackup = () => { try { const f = bk.makeBackup(app.d.db, bdir); bk.prune(bdir); app.mon.lastBackupOk = Date.now(); app.mon.lastBackupError = null; console.log('バックアップ作成:', f); } catch (e) { app.mon.lastBackupError = e.message; console.error('★バックアップ失敗:', e.message); } };
  // 控えが本体と同じディスクにあると、ディスクが壊れたとき両方なくなる。健康診断で「注意」にする
  try { fs.mkdirSync(bdir, { recursive: true }); app.mon.backupSameDisk = fs.statSync(bdir).dev === fs.statSync(path.dirname(file)).dev; } catch (e) {}
  if (app.mon.backupSameDisk) console.log('注意: バックアップが本体と同じディスクにあります。BACKUP_DIR を別の場所にしてください');
  runBackup(); setInterval(runBackup, 3600000).unref();
  // 想定外の失敗で、全部の卓を巻き込んで落ちないようにする。記録して健康診断を「警報」にし、人が判断する
  process.on('uncaughtException', e => { app.mon.uncaught++; console.error('★想定外のエラー', e); });
  process.on('unhandledRejection', e => { app.mon.uncaught++; console.error('★想定外のエラー(約束の失敗)', e); });
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, () => console.log('ソロ: http://localhost:' + port));
}
module.exports = { createApp };
