/* 体験版の本体: 通信のにせもの(fetch / EventSource)、テスト用の世界、ボット、立場の切り替え */
(function () {
'use strict';
const PW = 'password-1';
const realFetch = window.fetch.bind(window);
let APP = null;
const ipByToken = {};
const ipOf = name => '10.8.' + (Array.from(name).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 250, 7) + 1) + '.' + (name.length + 10);

/* ---------- 通信のにせもの ---------- */
function mkReq(method, url, token, body, ip) {
  const L = {};
  const req = {
    method, url, headers: { authorization: token ? 'Bearer ' + token : '' }, socket: { remoteAddress: ip || '10.9.9.9' }, destroy() {},
    on(ev, cb) { (L[ev] = L[ev] || []).push(cb); if (ev === 'end') setTimeout(() => { (L.data || []).forEach(f => f(body)); (L.end || []).forEach(f => f()); }, 0); return req; },
    emit(ev) { (L[ev] || []).forEach(f => f()); }
  };
  return req;
}
async function rawCall(method, url, token, bodyObj, ip) {
  if (!ip) { const m = String(url).match(/token=([^&]+)/); ip = ipByToken[token || (m && decodeURIComponent(m[1]))]; }
  const bodyStr = method === 'GET' || bodyObj == null ? '' : JSON.stringify(bodyObj);
  const req = mkReq(method, url, token, bodyStr, ip);
  let out = null;
  const res = { headersSent: false, writeHead(c) { this.code = c; this.headersSent = true; }, write() {}, end(c) { out = { status: this.code || 200, body: c || '' }; } };
  await APP.handler(req, res);
  return out || { status: 200, body: '{}' };
}
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  init = init || {};
  const token = ((init.headers && init.headers.Authorization) || '').replace(/^Bearer /, '');
  let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch (e) {}
  const ip = body && body.username ? ipOf(body.username) : undefined;
  const o = await rawCall((init.method || 'GET').toUpperCase(), url, token, body, ip);
  let j = {}; try { j = JSON.parse(o.body); } catch (e) {}
  if (j && j.token && ip) ipByToken[j.token] = ip;
  return { ok: o.status < 400, status: o.status, json: async () => j, text: async () => o.body };
};
class FakeES {
  constructor(url) {
    this.readyState = 0; this.url = url;
    const req = this._req = mkReq('GET', url, '', '');
    const self = this;
    const res = {
      headersSent: false,
      writeHead(c) { this.headersSent = true; if (c >= 400) { self.readyState = 2; setTimeout(() => self.onerror && self.onerror({}), 0); } else self.readyState = 1; },
      write(chunk) { String(chunk).split('\n').forEach(l => { if (l.startsWith('data: ') && self.readyState === 1 && self.onmessage) self.onmessage({ data: l.slice(6) }); }); },
      end() {}
    };
    APP.handler(req, res);
  }
  close() { if (this.readyState !== 2) { this.readyState = 2; this._req.emit('close'); } }
}
window.EventSource = FakeES;

/* ---------- ボット(別の人の代わりに卓に座る) ---------- */
async function login(name) {
  const o = await rawCall('POST', '/api/login', null, { username: name, password: PW, deviceId: 'bot-' + name }, ipOf(name));
  const j = JSON.parse(o.body); if (!j.token) throw new Error('ボットのログイン失敗 ' + name + ' ' + o.body); ipByToken[j.token] = ipOf(name); return j.token;
}
const pick = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
async function startBot(name, tableId) {
  const token = await login(name);
  let r = await rawCall('POST', `/api/tables/${tableId}/join`, token, { buyIn: 5000 });
  if (r.status >= 400) { console.warn('ボット着席失敗', name, r.body); return; }
  let busy = false, topping = false;
  const tk = JSON.parse((await rawCall('POST', `/api/tables/${tableId}/ticket`, token, {})).body).ticket;
  const es = new FakeES(`/api/tables/${tableId}/stream?ticket=${encodeURIComponent(tk)}`);
  es.onmessage = m => {
    let v; try { v = JSON.parse(m.data); } catch (e) { return; }
    if (v.ended) return;
    const me = (v.seats || []).find(s => s && s.you);
    if (me && !topping && v.settings && me.chips < v.settings.ante * 8) { topping = true; rawCall('POST', `/api/tables/${tableId}/exchange`, token, { dir: 'in', amount: v.settings.ante * 60 }).finally(() => { topping = false; }); }
    if (v.req && !busy) {
      busy = true; const q = v.req;
      setTimeout(async () => {
        let a;
        if (q.type === 'carryJoin') {
          if (q.short) { try { await rawCall('POST', `/api/tables/${tableId}/exchange`, token, { dir: 'in', amount: q.need }); a = { act: 'join' }; } catch (e) { a = { act: 'skip' }; } }
          else a = { act: Math.random() < 0.7 ? 'join' : 'skip' };
        } else if (q.type === 'oya') {
          if (q.canBet && Math.random() < 0.6) a = { act: 'bet', amount: Math.max(q.minBet, Math.min(q.cap, q.minBet * pick(1, 3))) };
          else if (q.canShow) a = { act: 'show' }; else a = { act: 'fold' };
        } else a = { act: Math.random() < 0.72 ? 'follow' : 'fold', amount: q.amount };
        try { await rawCall('POST', `/api/tables/${tableId}/act`, token, a); } catch (e) {}
        busy = false;
      }, pick(1100, 2600));
    }
  };
}

/* ---------- テスト用の世界 ---------- */
const ACCOUNTS = [
  { n: 'kaito', role: 'creator', label: '作成者', who: 'かいと(あなた)の立場。5億チップの持ち主' },
  { n: 'touhatsu', role: 'sovereign', label: '統括責任者', who: '作成者とほぼ同じ権限' },
  { n: 'kanri', role: 'manager', label: 'ゲーム管理責任者', who: 'AJにチップを配る' },
  { n: 'aj_one', role: 'aj', label: 'AJ(ハウスA)', who: 'ハウスAの持ち主。卓を作る' },
  { n: 'aj_two', role: 'aj', label: 'AJ(ハウスB)', who: '別のAJ。ハウスAには干渉できない' },
  { n: 'taro_p', role: 'player', label: 'プレイヤー 太郎', who: 'ハウスAの人(最初はここ)' },
  { n: 'hana_p', role: 'player', label: 'プレイヤー 花', who: 'ハウスAの人' },
  { n: 'riku_p', role: 'player', label: 'プレイヤー 陸', who: 'ハウスAの人' }
];
function seed() {
  const c = APP.core, T = APP.tables;
  const cid = c.bootstrap('kaito', PW, '09000000001'); const me = c.user(cid);
  let k = 0;
  const mk = (by, role, name) => { k++; return c.signup({ invite: c.createInvite(c.user(by), role).code, username: name, password: PW, phone: '0900000' + (3000 + k), deviceId: 'seed-' + name, ip: ipOf(name) }).id; };
  const sov = mk(cid, 'sovereign', 'touhatsu'), man = mk(sov, 'manager', 'kanri');
  const a1 = mk(man, 'aj', 'aj_one'), a2 = mk(man, 'aj', 'aj_two');
  // 作成者と統括責任者のポケットは1つ
  c.give(c.user(sov), man, 50000000); c.give(c.user(man), a1, 5000000); c.give(c.user(man), a2, 5000000);
  ['taro_p', 'hana_p', 'riku_p', 'yui_p', 'ken_p', 'mina_p'].forEach(n => { const id = mk(a1, 'player', n); c.give(c.user(a1), id, 300000); });
  ['sora_p', 'nami_p'].forEach(n => { const id = mk(a2, 'player', n); c.give(c.user(a2), id, 300000); });
  const t1 = T.create(c.user(a1), 'テーブル1(自由卓)', { seats: 6, ante: 100, minBet: 100, limit: 1000, lateJoin: 'allow' });
  T.create(c.user(a1), '条件卓(2人で開始)', { seats: 6, startMode: 'condition', chips: 20000, minPlayers: 2, endZero: 1, ante: 100, minBet: 100, limit: 2000 });
  const t2 = T.create(c.user(a2), 'ハウスBの卓', { seats: 6, ante: 100, minBet: 100, limit: 1000, lateJoin: 'allow' });
  return { t1: t1.id, t2: t2.id };
}

/* ---------- 画面: 立場の切り替え ---------- */
function ui() {
  const css = document.createElement('style');
  css.textContent = `
  #dm-tab{position:fixed;right:0;top:92px;z-index:9998;background:#C9A24Bdd;color:#070F1A;font:700 11px/1 'Zen Kaku Gothic New',sans-serif;padding:8px 4px;border-radius:8px 0 0 8px;writing-mode:vertical-rl;letter-spacing:.1em;cursor:pointer;box-shadow:0 2px 8px #0008}
  #dm-ov{position:fixed;inset:0;z-index:9999;background:#000b;display:none}
  #dm-ov.on{display:block}
  #dm-box{position:absolute;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:#0D1B2A;color:#E8E4D8;border-top:2px solid #C9A24B;border-radius:16px 16px 0 0;padding:16px 16px 28px;font:14px/1.6 'Zen Kaku Gothic New',sans-serif;max-width:560px;margin:0 auto}
  #dm-box h2{margin:0 0 4px;font:700 20px 'Barlow Condensed','Zen Kaku Gothic New',sans-serif;letter-spacing:.06em;color:#C9A24B}
  #dm-box p{margin:6px 0}
  #dm-box .sm{font-size:12px;color:#9fb0bd}
  .dm-acc{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#12263a;border:1px solid #28425a;color:#E8E4D8;border-radius:10px;padding:9px 12px;margin:6px 0;font:inherit;cursor:pointer}
  .dm-acc.me{border-color:#C9A24B;background:#1b2f44}
  .dm-acc b{display:block}
  .dm-acc span{font-size:12px;color:#9fb0bd}
  .dm-acc i{margin-left:auto;font-style:normal;font-size:11px;color:#C9A24B}
  #dm-box details{margin:10px 0;background:#10202f;border-radius:10px;padding:8px 12px}
  #dm-box summary{cursor:pointer;font-weight:700}
  #dm-box ol,#dm-box ul{margin:6px 0 4px 18px;padding:0}
  .dm-b{background:#1C8196;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:700 14px 'Zen Kaku Gothic New',sans-serif;cursor:pointer;margin:6px 6px 0 0}
  .dm-b.g{background:#2a3d52}`;
  document.head.appendChild(css);
  const tab = document.createElement('div'); tab.id = 'dm-tab'; tab.textContent = '体験版・立場切替'; document.body.appendChild(tab);
  const ov = document.createElement('div'); ov.id = 'dm-ov'; document.body.appendChild(ov);
  const open = () => { render(); ov.classList.add('on'); };
  const close = () => ov.classList.remove('on');
  tab.addEventListener('click', open);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  function render() {
    const cur = S.me && S.me.user ? S.me.user.username : '';
    ov.innerHTML = `<div id="dm-box"><h2>SOLO 体験版 <span class="sm">DEMO</span></h2>
    <p class="sm">これは見て触って確かめるための体験版です。本物のサーバーのプログラムを、このページの中だけで動かしています。通信も保存もしません。ページを開き直すと最初に戻ります。お金や賞品とは一切関係ありません。</p>
    <p><b>いまの立場: ${cur ? e(cur) + '(' + e(ROLE_JA[S.me.user.role]) + ')' : '未ログイン'}</b></p>
    ${ACCOUNTS.map(a => `<button class="dm-acc ${a.n === cur ? 'me' : ''}" data-n="${a.n}"><div><b>${a.label}</b><span>${a.who}</span></div>${a.n === cur ? '<i>いまここ</i>' : ''}</button>`).join('')}
    <details open><summary>試してみること</summary><ol>
    <li><b>プレイヤー(太郎)</b>で、ホームの卓「テーブル1」に座ると、ボット3人(ゆい・けん・みな)と本物のルールで対戦できます。</li>
    <li><b>AJ(ハウスA)</b>でプレイヤーにチップを配る・引く、ハウスの入室パスワード(5分で変わる)を見る、卓を作る。</li>
    <li><b>ゲーム管理責任者</b>でAJにチップを配る。ハウスAのAJにはハウスBの中身が見えないことを、AJ(ハウスB)でも比べる。</li>
    <li><b>作成者</b>で全員のチップと台帳を見る。卓に座っていない作成者・統括は、卓の中身(手札つき)を観戦できます。</li>
    <li><b>太郎・花・陸</b>の3人で、同じボットを通報すると監視対象になり、管理側に「要チェック」が届きます。</li>
    <li>別のAJのハウスに入る: AJ(ハウスB)でパスワードを見て、プレイヤーで「ハウスに入る」から入力する。</li></ol></details>
    <details><summary>この体験版でできないこと</summary><ul>
    <li>本物の他人との対戦(相手はボットです)</li><li>電話番号のSMS認証と年齢の本人確認(まだ作っていません)</li>
    <li>データの保存(閉じると消えます)</li><li>途中退席は、体験版では着席から1分後からできます(本番の設定は15分)</li></ul></details>
    <button class="dm-b g" data-x="close">閉じる</button><button class="dm-b g" data-x="reload">最初からやり直す</button></div>`;
  }
  window.__dmOpen = open;
  ov.addEventListener('click', async e => {
    const b = e.target.closest('[data-n],[data-x]'); if (!b) return;
    if (b.dataset.x === 'close') return close();
    if (b.dataset.x === 'reload') return location.reload();
    close(); await switchTo(b.dataset.n);
  });
}
async function switchTo(name) {
  const r = await (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: PW, deviceId: 'demo-' + name }) })).json();
  if (!r.token) return toast('切り替えに失敗しました', true);
  stopTable(); S.token = r.token; saveToken(r.token); S.me = null; S.skipResume = false; S.tab = 'home'; S.house = null;
  if (location.hash === '#/home') route(); else location.hash = '#/home';
}

/* ---------- 起動 ---------- */
window.__demoStart = async function (wasmB64, appSrc) {
  const bin = Uint8Array.from(atob(wasmB64), c => c.charCodeAt(0));
  window.__sqlite3 = await window.sqlite3InitModule({ print() {}, printErr() {}, instantiateWasm(info, receive) { WebAssembly.instantiate(bin, info).then(r => receive(r.instance, r.module)); return {}; } });
  const { createApp } = window.__require('./index');
  APP = createApp({ tables: { beatScale: 1, turnMs: 40000, minStayMs: 60000, graceMs: 60000, disconnectGraceMs: 8000 } });
  const ids = seed();
  for (const n of ['yui_p', 'ken_p', 'mina_p']) await startBot(n, ids.t1);
  for (const n of ['sora_p', 'nami_p']) await startBot(n, ids.t2);
  window.__demoToken = await login('taro_p');
  // アプリの画面を読み込む(通信のにせものを入れた後に)
  const s = document.createElement('script'); s.textContent = appSrc; document.body.appendChild(s);
  ui(); setTimeout(() => window.__dmOpen(), 700);
  window.__demo = { APP, ids, rawCall };
};
})();
