'use strict';
/* ソロ 画面(ログイン・ホーム・管理)。卓の画面は table.js */
const S = { token: null, me: null, tab: 'home', house: null, data: {}, timers: [] };
const ROLE_JA = { creator: '作成者', sovereign: '統括責任者', manager: 'ゲーム管理責任者', aj: 'AJ', player: 'プレイヤー' };
const RANK = { creator: 1, sovereign: 2, manager: 3, aj: 4, player: 5 };
const $ = (s, r) => (r || document).querySelector(s);
const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null ? '-' : Number(n).toLocaleString('ja-JP'));
const A = {};   // クリック処理: data-a="名前" data-v="値"
function toast(m, err) { const t = $('#toast'); t.textContent = m; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, err ? 4200 : 2200); }
function deviceId() { try { let d = localStorage.getItem('solo_dev'); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('solo_dev', d); } return d; } catch (x) { return 'nostorage-' + Math.random().toString(16).slice(2).padEnd(14, '0'); } }
function saveToken(t) { try { t ? localStorage.setItem('solo_tok', t) : localStorage.removeItem('solo_tok'); } catch (x) {} }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: S.token ? 'Bearer ' + S.token : '' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch (x) {}
  if (!r.ok) { if (r.status === 401 && S.token) { S.token = null; saveToken(null); go('#/login'); } throw new Error(j.error || 'エラーが起きました'); }
  return j;
}
const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (x) { toast(x.message, true); return null; } };
const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
const num = id => Number(val(id));
function go(h) { if (location.hash === h) route(); else location.hash = h; }
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-a]'); if (!t || t.disabled) return;
  const f = A[t.dataset.a]; if (f) { ev.preventDefault(); f(t.dataset.v, t); }
});
const clearTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };

/* ---------- ページ内の入力画面(ブラウザ標準の prompt / confirm は使わない) ---------- */
function dlg(o) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'dlg';
    const btns = o.buttons || [{ label: 'OK', value: true, cls: 'gold' }];
    ov.innerHTML = `<div class="dlg-box" role="dialog" aria-modal="true"><div class="dlg-msg">${e(o.msg)}</div>${o.input ? `<input id="dlg_in" ${o.numeric ? 'inputmode="numeric"' : ''} value="${e(o.def == null ? '' : o.def)}" autocomplete="off">` : ''}<div class="row dlg-btns"><button class="btn" data-d="cancel">やめる</button>${btns.map((b, i) => `<button class="btn ${b.cls || ''}" data-d="${i}">${e(b.label)}</button>`).join('')}</div></div>`;
    const done = v => { ov.remove(); resolve(v); };
    ov.addEventListener('click', ev => {
      const b = ev.target.closest('[data-d]'); if (!b) { if (ev.target === ov) done(null); return; }
      ev.stopPropagation();
      if (b.dataset.d === 'cancel') return done(null);
      const btn = btns[Number(b.dataset.d)]; done(o.input ? ov.querySelector('#dlg_in').value : btn.value);
    });
    ov.addEventListener('keydown', ev => { if (ev.key === 'Enter' && o.input) { ev.preventDefault(); const bt = ov.querySelector('[data-d="0"]'); if (bt) bt.click(); } if (ev.key === 'Escape') done(null); });
    document.body.appendChild(ov);
    const inp = ov.querySelector('#dlg_in'); if (inp) { inp.focus(); inp.select(); }
  });
}
const askText = (msg, def, numeric) => dlg({ msg, input: true, def, numeric, buttons: [{ label: 'OK', value: true, cls: 'gold' }] });
const askYes = (msg, label) => dlg({ msg, buttons: [{ label: label || 'はい', value: true, cls: 'gold' }] }).then(v => v === true);

/* ---------- ログイン・登録 ---------- */
function authScreen(mode) {
  clearTimers();
  const su = mode === 'signup';
  $('#app').innerHTML = `<div class="auth"><div class="logo"><b>SOLO</b><span>ソロ ・ 沖縄のカードゲーム</span></div>
  <div class="card">
    <h3>${su ? 'SIGN UP' : 'LOG IN'}<small>${su ? 'アカウントを作る' : 'ログイン'}</small></h3>
    ${su ? `<label>招待コード<small>(AJなどから受け取ったもの)</small></label><input id="f_inv" autocapitalize="characters" autocomplete="off">` : ''}
    <label>ユーザー名<small>(3〜20文字)</small></label><input id="f_user" autocomplete="username" autocapitalize="none">
    <label>パスワード<small>(8文字以上)</small></label><input id="f_pass" type="password" autocomplete="${su ? 'new-password' : 'current-password'}">
    ${su ? `<label>電話番号<small>(1つの電話番号につきアカウントは1つ)</small></label><input id="f_phone" inputmode="tel" autocomplete="tel" placeholder="09012345678">
    <p class="mute">電話番号は、1人が複数のアカウントを作るのを防ぐためだけに使います。画面には出ず、暗号化した値で保存します。<br>※ 現在のテスト版では、SMSでの本人確認はまだ行っていません。</p>
    <label style="display:flex;gap:8px;align-items:flex-start;letter-spacing:0;font-weight:400;font-size:13px;color:var(--soft)"><input id="f_age" type="checkbox" style="width:20px;margin-top:2px">18歳以上であり、利用規約に同意します</label>` : ''}
    <button class="btn gold block" style="margin-top:16px" data-a="${su ? 'doSignup' : 'doLogin'}">${su ? 'SIGN UP <small>登録する</small>' : 'LOG IN <small>ログイン</small>'}</button>
    <button class="btn block" style="margin-top:8px;border:0;background:none" data-a="goAuth" data-v="${su ? 'login' : 'signup'}">${su ? 'ログインへ' : '招待コードをお持ちの方はこちら'}</button>
  </div>
  <p class="mute" style="text-align:center">このゲームのチップは、お金には交換できません。</p></div>`;
}
A.goAuth = v => go('#/' + v);
A.doLogin = async () => {
  const r = await run(() => api('POST', '/api/login', { username: val('f_user'), password: val('f_pass'), deviceId: deviceId() })); if (!r) return;
  S.token = r.token; saveToken(r.token); go('#/home');
};
A.doSignup = async () => {
  if (!$('#f_age').checked) return toast('18歳以上であることへの同意が必要です', true);
  const r = await run(() => api('POST', '/api/signup', { invite: val('f_inv'), username: val('f_user'), password: val('f_pass'), phone: val('f_phone'), age18: true, deviceId: deviceId() })); if (!r) return;
  toast('登録できました。ログインしてください'); go('#/login');
};

/* ---------- 共通の枠(下のタブ) ---------- */
function tabsFor(me) {
  const t = [['home', 'HOME', 'ホーム'], ['practice', 'PRACTICE', '練習'], ['wallet', 'POCKET', 'ポケット']];
  if (RANK[me.role] <= 4) t.push(['admin', 'ADMIN', '管理']);
  t.push(['notice', 'NOTICE', '通知']);
  return t;
}
function frame(inner) {
  const m = S.me, tabs = tabsFor(m.user);
  $('#app').innerHTML = `<div class="page"><div class="top"><div class="brand">SOLO<small>${e(m.user.username)} ・ ${ROLE_JA[m.user.role]}</small></div>
    <span><button class="btn sm" data-a="bgmSheet" aria-label="BGMの曲">♫</button> <button class="btn sm" data-a="sfxToggle" aria-label="音">${typeof SFX !== 'undefined' && SFX.on ? (SFX.ctx && SFX.ctx.state === 'running' ? '♪ ON' : '♪ タップで有効') : '♪ OFF'}</button> <button class="btn sm" data-a="logout">LOG OUT<small style="display:none"></small></button></span></div>${noticeBanner()}${inner}${adBanner(S.tab)}</div>
    <div class="tabs"><div class="tabs-in">${tabs.map(t => `<button class="${S.tab === t[0] ? 'on' : ''}" data-a="tab" data-v="${t[0]}">${t[1]}<small>${t[2]}</small>${t[0] === 'notice' && m.unread ? '<i class="dot"></i>' : ''}</button>`).join('')}</div></div>`;
}
A.tab = v => { S.tab = v; if (v === 'practice') return go('#/practice'); renderHome(); };
A.logout = async () => { await run(() => api('POST', '/api/logout', {})); S.token = null; saveToken(null); S.me = null; go('#/login'); };
async function loadMe() { S.me = await api('GET', '/api/me'); return S.me; }

async function renderHome() {
  clearTimers();
  try { await loadMe(); } catch (x) { return toast(x.message, true); }
  if (S.me.maintenance && !['creator', 'sovereign'].includes(S.me.user.role)) return maintView();
  if (S.me.seatedAt && !S.skipResume) { go('#/table/' + S.me.seatedAt); return; }
  ({ home: homeTab, wallet: walletTab, admin: adminTab, notice: noticeTab })[S.tab] ? await ({ home: homeTab, wallet: walletTab, admin: adminTab, notice: noticeTab })[S.tab]() : homeTab();
}

/* ---------- システム更新中(作成者・統括責任者以外に見せる画面) ---------- */
function maintView() {
  $('#app').innerHTML = `<div class="auth"><div class="logo"><b>SOLO</b><span>システム更新中</span></div><div class="card"><h3>MAINTENANCE<small>システム更新中です</small></h3>
  <p style="margin:0 0 8px">ただいまシステムを更新しています。終わるまで、少しお待ちください。</p>${S.me.maintenance.msg ? `<p class="note">${e(S.me.maintenance.msg)}</p>` : ''}
  <p class="mute" style="margin:8px 0 0">卓に座っていた人のチップは、ポケットに戻っています。このページは自動で確認して、終わったら元の画面に戻ります。</p></div>
  <button class="btn block" data-a="logout">LOG OUT<small>ログアウト</small></button></div>`;
  clearTimers(); S.timers.push(setTimeout(renderHome, 15000));
}
A.maint = async v => {
  const on = v === '1'; const msg = on ? await askText('利用者に見せるひとこと(空欄でもかまいません。例: 21時ごろまで)', '', false) : '';
  if (on && msg == null) return;
  if (on && !(await askYes('システム更新中にします。動いている卓は、今のゲームが終わり次第すべて終了し、チップはポケットに戻ります。作成者・統括責任者以外は使えなくなります。よろしいですか?', '更新中にする'))) return;
  const r = await run(() => api('POST', '/api/maintenance', { on, msg: msg || '' }), on ? '更新中にしました' : '再開しました'); if (r) { S.me = await api('GET', '/api/me'); adminTab(); }
};
A.maintNotice = async () => {
  const x = await askText('何分後に「システム更新中」にしますか?(利用者には、それまで予告が表示されます)', '30', true); if (!x) return;
  const min = Math.floor(Number(x)); if (!(min >= 1 && min <= 1440)) return toast('1〜1440分で入力してください', true);
  const msg = await askText('利用者に見せるひとこと(空欄でもかまいません)', '', false); if (msg == null) return;
  if (await run(() => api('POST', '/api/maintenance', { on: false, at: Date.now() + min * 60000, msg: msg || '' }), '予告を出しました')) { S.me = await api('GET', '/api/me'); adminTab(); }
};
A.maintCancel = async () => { if (await run(() => api('POST', '/api/maintenance', { on: false }), '予告を取り消しました')) { S.me = await api('GET', '/api/me'); adminTab(); } };
function maintCard() {
  const on = !!S.me.maintenance;
  return `<div class="card"><h3>MAINTENANCE<small>システム更新</small></h3><p class="mute" style="margin-top:0">本番でルールや機能を変えたいとき、先に「更新中」にすると、利用者には「システム更新中です」と表示されます。卓は今のゲームのあとに終了し、チップはポケットへ戻るので、途中のゲームの最中にルールが変わることはありません。作成者・統括責任者は、更新中でも使えます。</p>
  <p>いまの状態: <b class="${on ? 'redc' : 'tealc'}">${on ? 'システム更新中' : '通常運転'}</b></p>
  <button class="btn ${on ? 'gold' : 'red'} block" data-a="maint" data-v="${on ? '0' : '1'}">${on ? '更新を終えて再開する' : 'システム更新中にする'}</button>${on ? '' : `<button class="btn block" style="margin-top:8px" data-a="maintNotice">予告を出す<small>○分後に自動で更新中にします</small></button>`}${S.me.maintNotice ? `<p class="mute">予告中: ${new Date(S.me.maintNotice.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}に自動で更新中になります <button class="btn sm" data-a="maintCancel">予告を取り消す</button></p>` : ''}</div>`;
}

/* ---------- ホーム: ハウスと卓 ---------- */
function settingsSummary(s) {
  const p = [`参加料${fmt(s.ante)}`, `ベット${fmt(s.minBet)}〜${fmt(s.limit)}`, s.upEnabled ? `アップあり(上限${fmt(s.upLimit == null ? s.limit : s.upLimit)})` : 'アップなし'];
  if (s.gameMaxBets) p.push(`通算ベット${s.gameMaxBets}回まで`); if (s.gameMaxUps) p.push(`通算アップ${s.gameMaxUps}回まで`);
  if (s.startMode === 'condition') p.push(`条件開始 ${fmt(s.chips)}チップ・${s.minPlayers}人で開始`); else p.push('自由参加');
  if (s.durationMin) p.push(s.durationMin + '分'); if (s.endZero) p.push(s.endZero + '人が出られなくなると終了');
  p.push(s.lateJoin === 'allow' ? '途中参加OK' : s.lateJoin === 'vote' ? '途中参加は投票' : '途中参加なし'); p.push(s.leave === 'allow' ? '退席OK(15分後)' : '退席なし');
  return p.join(' ・ ');
}
function noticeBanner() {
  const n = S.me && S.me.maintNotice; if (!n) return '';
  return `<div class="warn" style="margin:12px 0">${new Date(n.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}ごろから、システムを更新します。そのとき動いている卓は、今のゲームが終わり次第すべて終了し、チップはポケットに戻ります。${n.msg ? '<br>' + e(n.msg) : ''}</div>`;
}
async function homeTab() {
  S.tab = 'home';
  const m = S.me, houses = m.houses;
  if (!S.house || !houses.find(h => h.id === S.house)) S.house = m.homeHouse || (houses[0] && houses[0].id) || null;
  let tables = [];
  if (S.house) { try { tables = await api('GET', '/api/tables?houseId=' + S.house); } catch (x) { toast(x.message, true); } }
  S.data.tables = tables;
  frame(`<div class="card"><div class="pocket"><div><div class="mute">POCKET ・ ポケット</div><div class="n">${fmt(m.pocket)}<span style="font-size:16px"> チップ</span></div></div></div>
    <p class="mute" style="margin:8px 0 0">チップは、直のAJから受け取ります。卓に座るときは、ポケットのチップを卓に持ち込みます。</p></div>
  <div class="card"><h3>HOUSE<small>ハウス</small></h3>
    <div class="chips">${houses.map(h => `<button class="${h.id === S.house ? 'on' : ''}" data-a="pickHouse" data-v="${h.id}">${e(h.name)}${h.home ? ' ★' : ''}</button>`).join('') || '<span class="mute">まだハウスがありません</span>'}</div>
    ${S.house && !(houses.find(h => h.id === S.house) || {}).home ? `<button class="btn sm" style="margin-top:8px" data-a="leaveHouse">このハウスから抜ける</button>` : ''}
    <div class="hr"></div>
    <div class="mute">他のAJのハウスに入る(ハウスIDと、AJが教えるパスワード。パスワードは5分で変わります)</div>
    <div class="row" style="margin-top:6px"><input id="hj_id" placeholder="ハウスID" inputmode="numeric" style="flex:1"><input id="hj_pw" placeholder="パスワード" inputmode="numeric" style="flex:1"><button class="btn" data-a="joinHouse">JOIN</button></div></div>
  <div class="card"><h3>TABLES<small>卓</small></h3>
    ${tables.length ? tables.map(t => `<div class="tbl-item"><div class="nm"><b>${e(t.name)}</b><span class="mute">${e(settingsSummary(t.settings))}</span><br><span class="mute">${t.seated}/${t.seats}人 ${t.players.length ? '・ ' + t.players.map(e).join(' ') : ''}</span></div>
      <div style="text-align:right">${t.status === 'running' ? '<span class="pill gold">進行中</span>' : '<span class="pill">待機</span>'}<br><button class="btn sm gold" style="margin-top:6px" data-a="sit" data-v="${t.id}">SIT<small>座る</small></button></div></div>`).join('') : '<p class="mute">いまは卓がありません。AJが卓を作ると、ここに出ます。</p>'}
  </div>`);
}
A.pickHouse = v => { S.house = v; homeTab(); };
A.leaveHouse = async () => { if (await run(() => api('POST', '/api/houses/leave', { houseId: S.house }), 'ハウスから抜けました')) { S.house = null; renderHome(); } };
A.joinHouse = async () => { const r = await run(() => api('POST', '/api/houses/join', { houseId: val('hj_id').trim(), password: val('hj_pw').trim() })); if (r) { toast(r.name + ' に入りました'); S.house = r.houseId; renderHome(); } };
function feeNote(full) {   // 座るときに、別にかかる参加費の説明
  const p = S.me.pass; if (!p || p.exempt) return '';
  if (p.until) return full ? '今の1時間は参加費を払い済みです。' : ' ・ 参加費は払い済み';
  return full ? `別に、参加費 ${fmt(p.next)}チップがポケットから引かれます(合計 ${fmt(p.next)}チップ以上、ポケットに必要)。` : ` ・ 別に参加費 ${fmt(p.next)}チップがポケットから引かれます`;
}
const keepNote = s => (s.leave !== 'allow' ? '\n\nこの卓では途中で卓のチップをポケットに戻せません。卓が終われば、チップは全部ポケットに戻ります。' : '');   // 途中退席できない卓(勝ち逃げを防ぐため)
const jpNote = () => (S.me && S.me.rules && S.me.rules.jackpotBp > 0 ? '\n\n🎰 公平のため、途中から参加した人は、ジャックポットを「参加してから積み上がった分」までしか取れません。' : '');
A.sit = async v => {
  const t = S.data.tables.find(x => x.id === Number(v)); if (!t) return;
  const s = t.settings; let buy = s.chips;
  if (s.startMode === 'free') {
    const min = s.ante + s.reserve + s.limit;
    const x = await askText(`卓にいくら持ち込んで座りますか?(ポケット ${fmt(S.me.pocket)}チップ / 最低 ${fmt(min)}チップ${feeNote()})${keepNote(s)}${jpNote()}`, String(Math.min(S.me.pocket, Math.max(min, 5000))), true);
    if (x == null) return; buy = Number(x);
  } else if (!(await askYes(`この卓は、${fmt(s.chips)}チップを${fmt(s.chips)}チップに替えて参加します。${feeNote(true)}${s.minPlayers}人そろうまで待ち、終了まで席を立てません。座りますか?${jpNote()}`, '座る'))) return;
  const r = await run(() => api('POST', '/api/tables/' + t.id + '/join', { buyIn: buy })); if (!r) return;
  if (r.vote) toast('参加の投票を待っています(着席者の過半数で承認)'); 
  S.skipResume = false; go('#/table/' + t.id);
};

/* ---------- 参加費の状態 ---------- */
function passCard() {
  const p = S.me.pass, r = S.me.rules; if (!p || p.exempt) return '';
  const hm = ts => new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return `<div class="card"><h3>ENTRY FEE<small>参加費</small></h3>
  <p style="margin:0 0 6px">${p.until ? `いまの1時間は支払い済みです(${hm(p.until)}まで)。この間は卓を移っても、ハウスを移っても、また払う必要はありません。` : '今は支払い済みの時間がありません。卓が始まるか、着席すると引かれます。'}</p>
  <p class="mute" style="margin:0">次に引かれる額: <b>${fmt(p.next)}チップ</b>(今日${p.count}回目まで払い済み)。1日(日本時間の0時区切り)で、1時間目と2時間目は${fmt(r.entryFirst)}チップ、3時間目からは1時間${fmt(r.entryNext)}チップです。卓のチップからではなく、ポケットから引かれます。ポケットにチップがないとプレイできません(5分前に通知します)。</p></div>`;
}

/* ---------- 有料プラン ---------- */
function planCard() {
  const p = S.me.plan; if (!p || !p.plan) return '';
  const d = ts => new Date(ts).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
  const b = p.sub, ST = { active: '利用中', trialing: '利用中', past_due: '支払いが確認できていません', canceled: '解約済み', incomplete: '手続きが終わっていません', incomplete_expired: '手続きの期限切れ', unpaid: '未払い' };
  let body;
  if (p.active) body = `<p style="margin:0 0 6px"><b>${e(p.planName)}を利用中です</b>(月${fmt(b.price || p.price)}円)。${b.cancelAtEnd ? `解約済みで、<b>${d(b.periodEnd)}まで</b>使えます。` : `次の更新日: ${d(b.periodEnd)}`}</p>
    ${b.status === 'past_due' ? '<p class="redc" style="margin:0 0 6px">支払いができませんでした。下のボタンからカードを確かめてください。</p>' : ''}
    <button class="btn block" data-a="planPortal">解約・カードの変更 <small>Stripeの画面が開きます</small></button>`;
  else if (p.open) body = `<p style="margin:0 0 6px">${e(p.planName)}: <b>月${fmt(p.price)}円</b>(毎月自動で払います。いつでも解約できます)</p>
    <p class="mute" style="margin:0 0 8px">チップは増えません。プランで変わるのは、広告が出なくなることなどです。${b ? '<br>前回の状態: ' + e(ST[b.status] || b.status) : ''}</p>
    ${p.test ? '<p class="redc" style="margin:0 0 8px">テスト中です。本物のお金は動きません。カード番号は「4242 4242 4242 4242」を使ってください。</p>' : ''}
    <button class="btn gold block" data-a="planBuy">申し込む <small>Stripeの支払い画面へ</small></button>${b && b.portal ? '<button class="btn block" style="margin-top:8px" data-a="planPortal">支払いの記録を見る</button>' : ''}`;
  else body = '<p class="mute" style="margin:0">有料プランは準備中です。いまは全ての機能を無料で使えます。</p>';
  return `<div class="card"><h3>PLAN<small>有料プラン</small></h3>${body}</div>`;
}
A.planBuy = async (v, btn) => { if (btn) btn.disabled = true; const r = await run(() => api('POST', '/api/plan/checkout', {})); if (r && r.url) location.href = r.url; else if (btn) btn.disabled = false; };
A.planPortal = async (v, btn) => { if (btn) btn.disabled = true; const r = await run(() => api('POST', '/api/plan/portal', {})); if (r && r.url) location.href = r.url; else if (btn) btn.disabled = false; };
async function plansCard() {
  let r; try { r = await api('GET', '/api/admin/plans'); } catch (x) { return ''; }
  const d = ts => new Date(ts).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
  return `<div class="card"><h3>PLANS<small>有料プランの加入者</small></h3>
  <p class="mute" style="margin-top:0">${r.ready ? (r.test ? '<span class="redc">テストモード(本物のお金は動きません)</span>' : '<b class="redc">本番モード(本物のお金が動きます)</b>') : '決済の鍵が未設定です(申し込みボタンは出ません)'} ・ 申し込み: ${r.open ? '受け付け中' : '停止中(設定の「有料プラン」で変えられます)'}<br>利用中 <b>${fmt(r.count)}人</b> ・ 来月の見込み <b>${fmt(r.monthly)}円</b>(Stripeの手数料を引く前)</p>
  ${r.rows.length ? `<table class="t"><tr><th>名前</th><th>プラン</th><th>状態</th><th class="r">期限</th></tr>${r.rows.map(x => `<tr><td>${e(x.user)}</td><td>${e(x.plan)}<br><span class="mute">${x.price ? fmt(x.price) + '円' : ''}</span></td><td>${x.active ? '利用中' : '停止'}<br><span class="mute">${e(x.status)}${x.cancelAtEnd ? '・解約予定' : ''}</span></td><td class="r">${x.periodEnd ? d(x.periodEnd) : '-'}</td></tr>`).join('')}</table>` : '<p class="mute">まだ加入者はいません。</p>'}</div>`;
}

/* ---------- ポケット(履歴) ---------- */
async function walletTab() {
  S.tab = 'wallet';
  const rows = await api('GET', '/api/ledger');
  const KIND = { give: '受け取り/配布', pull: '引き取り', buyin: '卓に持ち込み', cashout: '卓からポケットに戻す', chip_in: 'チップを追加', chip_out: 'チップをポケットに戻す', expel_return: '退会による返還', mint: '初期発行', supply_change: '総量の変更', game: 'ゲーム', recover: '復旧', recover_pot: '復旧', entry_fee: '参加費(1時間)', fee_receive: '手数料・参加費を受け取る' };
  frame(`<div class="card"><div class="pocket"><div><div class="mute">POCKET ・ ポケット</div><div class="n">${fmt(S.me.pocket)}<span style="font-size:16px"> チップ</span></div></div>${S.me.pass && S.me.pass.exempt ? '<p class="mute">作成者と統括責任者のポケットは1つです(お二人で同じ残高)。参加費はかかりません。</p>' : ''}</div>
  ${passCard()}${planCard()}
  <div class="card"><h3>HISTORY<small>履歴(あなたに関係するものだけ)</small></h3>
  ${rows.length ? `<table class="t"><tr><th>日時</th><th>内容</th><th class="r">増減</th></tr>${rows.map(r => `<tr><td class="mute">${new Date(r.ts).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${KIND[r.kind] || r.kind}${r.by ? ` <span class="mute">(${e(r.by)}が実行)</span>` : ''}<br><span class="mute">${e(r.counter)}${r.note ? ' ・ ' + e(r.note) : ''}</span></td><td class="r ${r.delta >= 0 ? 'tealc' : 'redc'}">${r.delta >= 0 ? '+' : ''}${fmt(r.delta)}</td></tr>`).join('')}</table>` : '<p class="mute">まだ履歴がありません。</p>'}</div>`);
}

/* ---------- 通知 ---------- */
async function noticeTab() {
  S.tab = 'notice';
  const ns = await api('GET', '/api/notifications');
  const T = { plan: n => '有料プラン: ' + e(n.msg), check: n => `「要チェック」 ${e(n.user)} さん(疑わしい行動 ${n.count}回・直近: ${e(n.last)})`, watch: n => `監視対象になりました: ${e(n.user)} さん(通報者${n.reporters}人)`, pulled: n => `${e(n.by)} があなたのポケットから ${fmt(n.amount)}チップを引き取りました`, limit_request: n => `卓の上限の申請: ${e(n.aj)}`, fee_ready: n => `卓${n.table}の手数料・参加費が ${fmt(n.balance)}チップになりました。管理の「手数料」から受け取れます`, fee_warn: n => `あと${n.minutes}分で参加費(${fmt(n.need)}チップ)が引かれます。ポケットは${fmt(n.pocket)}チップです。AJにチップを入れてもらってください`, fee_blocked: n => `ポケットに参加費(${fmt(n.need)}チップ)がないため、卓${n.table}でお休み中です。AJにチップを入れてもらうと再開します`, nuisance: n => `迷惑行為の記録: ${e(n.user)} さん(${n.count}回目)`, limit_result: n => n.approved ? `卓の上限が ${n.newLimit} になりました` : '卓の上限の申請は見送られました' };
  frame(`<div class="card"><h3>NOTICE<small>通知</small></h3>${ns.length ? ns.map(n => `<div class="msgline" style="${n.read ? 'opacity:.6' : ''}">${(T[n.kind] || (() => e(n.kind)))(n.body)}<br><span class="mute">${new Date(n.ts).toLocaleString('ja-JP')}</span></div>`).join('') : '<p class="mute">通知はありません。</p>'}</div>`);
  if (S.me.unread) { await api('POST', '/api/notifications/read', {}); S.me.unread = 0; }
}

/* ---------- 管理(立場によって内容が変わる) ---------- */
function inviteCard(roles) {
  return `<div class="card"><h3>INVITE<small>招待コードを作る(1回だけ使え、7日で切れます)</small></h3>
  <div class="row"><select id="inv_role">${roles.map(r => `<option value="${r}">${ROLE_JA[r]}</option>`).join('')}</select><button class="btn gold" data-a="mkInvite">作る</button></div><div id="inv_out" style="margin-top:8px"></div></div>`;
}
A.mkInvite = async () => { const r = await run(() => api('POST', '/api/invites', { role: val('inv_role') })); if (r) $('#inv_out').innerHTML = `<div class="big">${e(r.code)}</div><div class="mute">${ROLE_JA[r.role]}用のコードです。相手に伝えてください。</div>`; };
function usersCard(users, title, opt) {
  opt = opt || {};
  return `<div class="card"><h3>${title}</h3>${users.length ? `<table class="t"><tr><th>名前</th><th>立場</th><th class="r">ポケット</th><th></th></tr>${users.map(u => `<tr><td>${e(u.username)}${u.status !== 'active' ? ` <span class="pill red">${u.status === 'watch' ? '監視中' : '退会'}</span>` : ''}<br><span class="mute">${u.parent_name ? '直: ' + e(u.parent_name) : ''}</span></td><td>${ROLE_JA[u.role]}</td><td class="r gold">${fmt(u.balance)}</td><td class="r"><button class="btn sm" data-a="moveUser" data-v="${u.id}|${e(u.username)}">配る/引く</button></td></tr>`).join('')}</table>` : '<p class="mute">まだいません。招待コードで追加します。</p>'}</div>`;
}
A.moveUser = async v => {
  const [id, name] = v.split('|');
  const act = await dlg({ msg: `${name} さんのチップを、どうしますか?`, buttons: [{ label: '配る', value: 'g', cls: 'gold' }, { label: '引き取る', value: 'p', cls: 'teal' }] }); if (!act) return;
  const amt = Math.floor(Number(String(await askText(act === 'p' ? `${name} さんから引き取るチップ(整数)` : `${name} さんへ配るチップ(整数)`, '', true)).replace(/[,\s]/g, ''))); if (!amt || amt < 1) return toast('1以上の数字を入力してください', true);
  const r = await run(() => act.startsWith('p') ? api('POST', '/api/pull', { from: Number(id), amount: amt }) : api('POST', '/api/give', { to: Number(id), amount: amt }), '実行しました');
  if (r) adminTab();
};
async function adminTab() {
  S.tab = 'admin'; clearTimers();
  const me = S.me.user, role = me.role; let html = '';
  const users = await api('GET', '/api/users');
  if (role === 'aj') {
    const h = await api('GET', '/api/house'); S.data.house = h;
    html += `<div class="card"><h3>MY HOUSE<small>あなたのハウス</small></h3>
      <div class="grid2"><div><div class="mute">ハウスID(固定)</div><div class="big" style="font-size:28px">${e(h.houseId)}</div></div>
      <div><div class="mute">入室パスワード(5分で変わる)</div><div class="big" style="font-size:28px" id="pwv">${e(h.password)}</div><div class="mute" id="pwt"></div></div></div>
      <p class="mute">他のAJのプレイヤーが入るときに教えてください。あなたの直のプレイヤーは、招待コードで登録した時点でこのハウスにいます。</p></div>
      ${inviteCard(['player'])}
      <div class="card"><h3>TABLES<small>卓 ${h.tables.length}/${h.tableLimit}</small></h3>
        ${h.tables.map(t => `<div class="tbl-item"><div class="nm"><b>${e(t.name)}</b><span class="mute">${e(settingsSummary(t.settings))}</span><br><span class="mute">${t.seated}/${t.seats}人 ${t.players.map(e).join(' ')}</span></div><div style="text-align:right"><button class="btn sm" data-a="editTable" data-v="${t.id}" ${t.seated ? 'disabled' : ''}>設定</button> <button class="btn sm red" data-a="stopTable" data-v="${t.id}">停止</button></div></div>`).join('') || '<p class="mute">卓はまだありません。</p>'}
        <button class="btn gold block" style="margin-top:8px" data-a="newTable">新しい卓 <small>NEW TABLE</small></button>
        <button class="btn block" style="margin-top:8px" data-a="reqLimit">卓の上限を上げる申請</button>
        <p class="mute">卓の設定は、誰かが座っている間は変更できません。上限は1ハウス${h.tableLimit}卓です(空の卓も数えます)。</p></div>
      <div id="tblform"></div>
      <div class="card"><h3>MEMBERS<small>ハウスのメンバー</small></h3><table class="t"><tr><th>名前</th><th class="r">ポケット</th><th></th></tr>${h.members.filter(m => m.id !== me.id).map(m => `<tr><td>${e(m.username)}${m.direct ? ' <span class="pill gold">直</span>' : ' <span class="pill">来訪</span>'}</td><td class="r gold">${m.direct ? fmt(m.balance) : '-'}</td><td class="r">${m.direct ? `<button class="btn sm" data-a="moveUser" data-v="${m.id}|${e(m.username)}">配る/引く</button>` : `<button class="btn sm red" data-a="kick" data-v="${m.id}">外す</button>`}</td></tr>`).join('') || '<tr><td class="mute" colspan=3>まだメンバーがいません</td></tr>'}</table></div>`;
    S.timers.push(setInterval(() => { const el = $('#pwt'); if (!el) return; const s = Math.max(0, Math.round((h.expiresAt - Date.now()) / 1000)); el.textContent = s ? `あと ${Math.floor(s / 60)}分${s % 60}秒` : '期限切れ(更新します)'; if (!s) adminTab(); }, 1000));
  } else if (role === 'manager') {
    html += inviteCard(['aj']) + usersCard(users, 'AJ・プレイヤー<small>配る/引き取る(ポケットから配れるのはAJまで)</small>');
    const lr = await api('GET', '/api/limit-requests');
    html += `<div class="card"><h3>LIMIT REQUESTS<small>卓の上限の申請(統括・作成者へ取り次ぎ)</small></h3>${lr.map(r => `<div class="tbl-item"><div class="nm"><b>${e(r.aj_name)}</b><span class="mute">${e(r.reason || '')}</span></div><button class="btn sm gold" data-a="fwdLimit" data-v="${r.id}">取り次ぐ</button></div>`).join('') || '<p class="mute">申請はありません。</p>'}</div>`;
    html += await watchCards();
  } else {  // 作成者・統括
    const lr = await api('GET', '/api/limit-requests');
    html += `<div class="card"><h3>TOTAL<small>チップの総量</small></h3><div class="pocket"><div class="n">${fmt(S.me.supply)}</div>${role === 'creator' ? '<button class="btn sm" data-a="chSupply">総量を変更</button>' : ''}</div><div id="chk" class="mute">検査中…</div></div>`;
    html += await feesCard() + await plansCard() + maintCard() + await settingsCard() + await requestsCard();
    html += inviteCard(['sovereign', 'manager', 'aj', 'player']) + usersCard(users, 'ALL USERS<small>全員(配る/引き取る)</small>');
    html += `<div class="card"><h3>LIMIT REQUESTS<small>卓の上限の申請</small></h3>${lr.map(r => `<div class="tbl-item"><div class="nm"><b>${e(r.aj_name)}</b><span class="mute">${e(r.reason || '')}</span></div><button class="btn sm gold" data-a="decLimit" data-v="${r.id}">決める</button></div>`).join('') || '<p class="mute">申請はありません。</p>'}</div>`;
    html += await watchCards();
    const tb = await api('GET', '/api/admin/tables');
    html += `<div class="card"><h3>WATCH TABLES<small>卓を見る(着席していないときだけ。手札も見えます。閲覧は記録されます)</small></h3>${tb.map(t => `<div class="tbl-item"><div class="nm"><b>${e(t.name)}</b><span class="mute">${e(t.houseName || '')} ・ ${t.seated}/${t.seats}人 ${t.players.map(e).join(' ')}</span></div><button class="btn sm" data-a="watchTable" data-v="${t.id}">見る</button></div>`).join('') || '<p class="mute">いま動いている卓はありません。</p>'}</div>`;
    const led = await api('GET', '/api/ledger/all');
    html += `<div class="card"><h3>FULL LEDGER<small>全体の台帳(新しい順)</small></h3><table class="t"><tr><th>#</th><th>口座</th><th>種類</th><th class="r">増減</th></tr>${led.slice(0, 60).map(r => `<tr><td class="mute">${r.id}</td><td>${e(r.acct)}</td><td class="mute">${e(r.kind)}</td><td class="r ${r.delta >= 0 ? 'tealc' : 'redc'}">${r.delta >= 0 ? '+' : ''}${fmt(r.delta)}</td></tr>`).join('')}</table></div>`;
    const au = await api('GET', '/api/admin/audit');
    html += `<div class="card"><h3>AUDIT<small>操作の記録</small></h3>${au.slice(0, 40).map(a => `<div class="msgline"><b>${e(a.action)}</b>${e(a.actor_name || 'システム')} → ${e(a.target || '')} <span class="mute">${new Date(a.ts).toLocaleString('ja-JP')}</span></div>`).join('')}</div>`;
  }
  frame(html || '<p class="mute">この立場の管理画面はありません。</p>');
  if (role === 'creator' || role === 'sovereign') api('GET', '/api/ledger/check').then(c => { const el = $('#chk'); if (el) el.innerHTML = c.ok ? `<span class="tealc">合計検査 OK</span> ・ 口座の合計 ${fmt(c.accounts)} = 総量 ${fmt(c.supply)}` : `<span class="redc">合計が合っていません!</span> ${JSON.stringify(c)}`; });
}
async function watchCards() {
  const [rep, watch, sus, shared, ips] = await Promise.all([api('GET', '/api/admin/reports'), RANK[S.me.user.role] <= 2 ? api('GET', '/api/admin/watch') : [], api('GET', '/api/admin/suspicion'), api('GET', '/api/admin/shared'), RANK[S.me.user.role] <= 2 ? api('GET', '/api/admin/banned-ips') : []]);
  const top = RANK[S.me.user.role] <= 2;
  let h = `<div class="card"><h3>CHECK<small>要チェック(疑わしい行動の回数)</small></h3>${sus.map(s => `<div class="tbl-item"><div class="nm"><b>${e(s.username)}</b><span class="mute">${s.n}回 ・ ${e(String(s.kinds).split(',').map(k => ({ same_device: '同じ端末で別アカウントにログイン', same_table_device: '同じ端末の人が同じ卓に着席', same_table_ip: '同じIPの人が同じ卓に着席' }[k.trim()] || k)).join(' / '))}</span></div></div>`).join('') || '<p class="mute">いまはありません。</p>'}</div>`;
  h += `<div class="card"><h3>REPORTS<small>通報された人</small></h3>${rep.map(r => `<div class="tbl-item"><div class="nm"><b>${e(r.username)}</b><span class="mute">通報者${r.reporters}人 ・ ${r.reports}件 ・ ${r.status === 'watch' ? '監視中' : r.status === 'banned' ? '退会済み' : ''}</span></div>${top && r.status !== 'banned' ? `<button class="btn sm red" data-a="expel" data-v="${r.id}|${e(r.username)}">退会</button> ${r.status === 'watch' ? `<button class="btn sm" data-a="clearWatch" data-v="${r.id}">解除</button>` : ''}` : ''}</div>`).join('') || '<p class="mute">通報はありません。</p>'}
  ${top ? '<p class="mute">監視対象になった人は、行動が確認されなければそのまま続行、確認された時点で退会にします。判断は作成者・統括責任者です。</p>' : ''}</div>`;
  h += `<div class="card"><h3>SHARED<small>同じ端末・同じIPのアカウント</small></h3>${shared.map(s => `<div class="msgline"><b>${s.type}</b>${s.users.split(',').map(e).join(' / ')}</div>`).join('') || '<p class="mute">ありません。</p>'}</div>`;
  if (top) h += `<div class="card"><h3>BANNED IP<small>退会者のIP(許可すると、そのユーザー名だけ通れます)</small></h3>${ips.map(i => `<div class="msgline"><b>${e(i.ip)}</b>${e(i.username || '')}</div>`).join('') || '<p class="mute">ありません。</p>'}<div class="row" style="margin-top:8px"><input id="ip_ip" placeholder="IP"><input id="ip_u" placeholder="ユーザー名"><button class="btn sm" data-a="ipPermit">許可</button></div></div>`;
  return h;
}
A.kick = async v => { if (await askYes('このプレイヤーをハウスから外しますか?', '外す') && await run(() => api('POST', '/api/house/kick', { userId: Number(v) }), '外しました')) adminTab(); };
A.stopTable = async v => { if (await askYes('この卓を止めますか?(今のゲームが終わったら終了し、チップはポケットに戻ります)', '止める') && await run(() => api('POST', '/api/tables/' + v + '/stop', {}), '停止します')) setTimeout(adminTab, 800); };
A.reqLimit = async () => { const r = await askText('卓の上限を上げたい理由を入力してください'); if (r != null && await run(() => api('POST', '/api/limit-requests', { reason: r }), '申請しました')) { } };
A.fwdLimit = async v => { if (await run(() => api('POST', '/api/limit-requests/' + v + '/forward', {}), '統括・作成者に取り次ぎました')) adminTab(); };
A.decLimit = async v => { const x = await askText('新しい上限(卓の数)を入力。空欄で見送り', '10', true); if (await run(() => api('POST', '/api/limit-requests/' + v + '/decide', { approve: !!x, newLimit: Number(x) }), '決めました')) adminTab(); };
A.chSupply = async () => { const x = await askText('新しい総量(整数)を入力。差額は作成者のポケットで増減します。', String(S.me.supply), true); if (x && await run(() => api('POST', '/api/supply', { supply: Number(x) }), '変更しました')) { renderHome(); } };
A.expel = async v => { const [id, n] = v.split('|'); const r = await askText(`${n} さんを退会させます。理由を入力してください(記録されます)`); if (r && await run(() => api('POST', '/api/admin/expel', { userId: Number(id), reason: r }), '退会にしました')) adminTab(); };
A.clearWatch = async v => { if (await run(() => api('POST', '/api/admin/clear', { userId: Number(v) }), '監視を解除しました')) adminTab(); };
A.ipPermit = async () => { if (await run(() => api('POST', '/api/admin/ip-permit', { ip: val('ip_ip'), username: val('ip_u') }), '許可しました')) adminTab(); };
A.watchTable = v => go('#/table/' + v);
/* 卓の作成フォーム */
async function settingsCard() {
  let c; try { c = await api('GET', '/api/config'); } catch (x) { return ''; }
  const when = ts => new Date(ts).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<div class="card"><h3>SETTINGS<small>設定(アプリの数字・ルール)</small></h3>
  <p class="mute" style="margin-top:0">手数料の割合や参加費などを、ここから変えられます。変えられるのは<b>「システム更新中」にしているあいだだけ</b>です(動いている卓の途中でルールが変わらないようにするため)。変えた内容は、下の履歴に残ります。${c.maintenance ? '' : '<br><span class="redc">いまは通常運転なので、変更できません。上の「システム更新中にする」を押してください。</span>'}</p>
  ${c.items.map((i, k) => `${k === 0 || c.items[k - 1].group !== i.group ? `<h4 style="margin:16px 0 4px;color:#C9A24B;letter-spacing:.1em">${e(i.group || '')}</h4>` : ''}<label>${e(i.label)} <small>${e(i.unit)} (${fmt(i.min)}〜${fmt(i.max)})</small></label><input id="cf_${i.key}" type="number" inputmode="numeric" value="${i.value}" ${c.maintenance ? '' : 'disabled'}>${i.note ? `<div class="mute" style="font-size:11px">${e(i.note)}</div>` : ''}`).join('')}
  <button class="btn gold block" style="margin-top:12px" data-a="cfgSave" ${c.maintenance ? '' : 'disabled'}>変更を保存する</button>
  <details style="margin-top:10px"><summary class="mute">変更の履歴</summary>${c.log.length ? c.log.map(l => `<div class="msgline"><span class="mute">${when(l.ts)} ${e(l.by)}</span><br>${l.changes.map(x => `${e(x.label)}: ${fmt(x.from)} → <b>${fmt(x.to)}</b>`).join('<br>')}</div>`).join('') : '<p class="mute">まだ変更はありません。</p>'}</details></div>`;
}
A.cfgSave = async () => {
  const patch = {}; document.querySelectorAll('[id^="cf_"]').forEach(el => { patch[el.id.slice(3)] = Number(el.value); });
  const r = await run(() => api('POST', '/api/config', { patch }), '保存しました'); if (r) { toast(`${r.changes.length}件を変更しました`); S.me = await api('GET', '/api/me'); adminTab(); }
};
async function requestsCard() {
  let rows; try { rows = await api('GET', '/api/requests'); } catch (x) { return ''; }
  return `<div class="card"><h3>REQUESTS<small>変更の要望(ここをこうしたい)</small></h3>
  <p class="mute" style="margin-top:0">新しい機能の追加や、なくしたい機能、仕組みの変更は、ここに書いて控えておけます。仕組み自体の変更は、アプリの中では書き換えられないので、この控えをもとに開発側(Claude)が作ります。状態を「未・対応中・済・なし」で管理できます。</p>
  <textarea id="rq_body" rows="3" maxlength="1000" placeholder="例: 卓の画面に〇〇を追加したい / △△の機能はなくしたい"></textarea>
  <button class="btn gold block" style="margin-top:8px" data-a="rqAdd">控える</button>
  ${rows.map(r => `<div class="msgline"><span class="mute">#${r.id} ${new Date(r.ts).toLocaleDateString('ja-JP')} ${e(r.username)}</span> <span class="pill ${r.status === '済' ? 'gold' : ''}">${e(r.status)}</span><br>${e(r.body)}<div class="row" style="margin-top:6px">${['未', '対応中', '済', 'なし'].map(st => `<button class="btn sm" data-a="rqSet" data-v="${r.id}|${st}">${st}</button>`).join('')}</div></div>`).join('')}</div>`;
}
A.rqAdd = async () => { const b = val('rq_body').trim(); if (!b) return toast('内容を入力してください', true); if (await run(() => api('POST', '/api/requests', { body: b }), '控えました')) adminTab(); };
A.rqSet = async v => { const [id, st] = v.split('|'); if (await run(() => api('POST', '/api/requests/' + id, { status: st }))) adminTab(); };
async function feesCard() {
  let rows = []; try { rows = await api('GET', '/api/fees'); } catch (x) { return ''; }
  const KIND = { entry: '参加費', rake: '手数料(運営の取り分)', receive: '受け取り' };
  const when = ts => new Date(ts).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const total = rows.reduce((a, r) => a + r.balance, 0);
  return `<div class="card"><h3>FEES<small>手数料・参加費(卓ごとの保管)</small></h3>
  <p class="mute" style="margin-top:0">参加費と、毎ゲームの手数料のうち運営の取り分(場のチップの${((S.me.rules||{}).feeBp||0)/100}%・切り上げ)は、卓ごとにここへ保管されます。手数料のもう一部(場のチップの${((S.me.rules||{}).jackpotBp||0)/100}%)はジャックポットの積立としてプレイヤーに戻るので、ここには入りません。「受け取る」を押すと、作成者と統括責任者の共有ポケットに入ります。押さなくても、プレイヤーやAJには戻りません。保管が5,000チップを超えるたびに通知します。</p>
  <p>受け取り待ち 合計: <b>${fmt(total)}チップ</b></p>
  ${rows.length ? rows.map(r => `<div class="tbl-item" style="display:block"><div class="row" style="justify-content:space-between"><div><b>${e(r.name)}</b> <span class="mute">卓${r.table_id}</span><br><span class="mute">保管 ${fmt(r.balance)} ・ 参加費の累計 ${fmt(r.entry_total)} ・ 手数料の累計 ${fmt(r.rake_total)} ・ 受け取り済み ${fmt(r.received_total)}</span></div>
    <button class="btn gold sm" data-a="feeReceive" data-v="${r.table_id}" ${r.balance > 0 ? '' : 'disabled'}>受け取る</button></div>
    <details><summary class="mute">時系列(新しい順)</summary><table class="t"><tr><th>日時</th><th>内容</th><th class="r">チップ</th></tr>${r.log.map(l => `<tr><td class="mute">${when(l.ts)}</td><td>${KIND[l.kind] || l.kind}${l.username ? ` <span class="mute">${e(l.username)}</span>` : ''}${l.note ? ` <span class="mute">${e(l.note)}</span>` : ''}</td><td class="r">${l.kind === 'receive' ? '−' : '+'}${fmt(l.amount)}</td></tr>`).join('')}</table></details></div>`).join('') : '<p class="mute">まだ記録はありません。</p>'}</div>`;
}
A.feeReceive = async v => { const r = await run(() => api('POST', '/api/fees/' + v + '/receive', {})); if (r) { toast(`${fmt(r.received)}チップを受け取りました`); S.me = await api('GET', '/api/me'); adminTab(); } };
function tableForm(t) {
  const s = Object.assign({}, S.me.defaults, t ? t.settings : {});
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(cur) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  const n = (id, label, v, sub) => `<div><label>${label}${sub ? `<small> ${sub}</small>` : ''}</label><input id="${id}" type="number" inputmode="numeric" value="${v}"></div>`;
  return `<div class="card"><h3>${t ? 'EDIT TABLE' : 'NEW TABLE'}<small>${t ? '設定を変更' : '新しい卓'}</small></h3>
  <label>卓の名前</label><input id="tf_name" value="${e(t ? t.name : '')}" maxlength="20">
  <div class="grid2">${n('tf_seats', '席の数', s.seats, '(2〜8)')}${sel2('tf_up', 'アップ', [[1, 'あり'], [0, 'なし']], s.upEnabled ? 1 : 0)}</div>
  <div class="grid2">${n('tf_ante', '参加料', s.ante, '(100以上・毎ゲーム場に残る)')}${n('tf_min', '最小ベット', s.minBet, '(100以上)')}</div>
  <div class="grid2">${n('tf_limit', 'ベット上限', s.limit)}<div><label>上限の種類</label>${sel('tf_lt', [['perBet', '1回ごと'], ['perGame', '1ゲーム合計']], s.limitType)}</div></div>
  <div class="grid2">${n('tf_uplimit', 'ビキのアップ上限', s.upLimit == null ? s.limit : s.upLimit)}<div><label>アップ上限の種類</label>${sel('tf_ult', [['perBet', '1回のアップごと'], ['perGame', '合計(1回で使い切り可)']], s.upLimitType || s.limitType)}</div></div>
  <div class="grid2">${sel2('tf_urs', '親が変わったらアップ上限を戻す', [[1, '戻す'], [0, '戻さない']], s.upResetOnOya === false ? 0 : 1)}<div></div></div>
  <div class="grid2">${n('tf_gmb', 'ゲーム通算ベット回数', s.gameMaxBets || 0, '(0=なし)')}${n('tf_gmu', 'ゲーム通算アップ回数', s.gameMaxUps || 0, '(0=なし)')}</div>
  <div class="grid2"><div><label>開始のしかた</label>${sel('tf_mode', [['free', '自由に参加'], ['condition', '条件開始(全員同じチップ)']], s.startMode)}</div>${n('tf_chips', '条件開始のチップ', s.chips, '(=pt)')}</div>
  <div class="grid2">${n('tf_minp', '開始人数', s.minPlayers, '(条件開始)')}${n('tf_dur', '時間(分)', s.durationMin, '(0=なし)')}</div>
  <div class="grid2">${n('tf_zero', '○人が出られなくなると終了', s.endZero, '(0=なし)')}<div><label>途中参加</label>${sel('tf_late', [['allow', '許可'], ['deny', '不許可'], ['vote', '着席者の多数決']], s.lateJoin)}</div></div>
  <div class="grid2"><div><label>途中退席</label>${sel('tf_leave', [['deny', '不許可'], ['allow', '許可(最低15分後)']], s.leave)}</div><div><label>卓のメッセージ</label>${sel('tf_chat', [[1, 'あり'], [0, 'なし']], s.chat ? 1 : 0)}</div></div>
  <p class="mute">条件開始の卓では、途中退席とポケットと卓のチップの移動はできません。</p>
  <button class="btn gold block" style="margin-top:8px" data-a="saveTable" data-v="${t ? t.id : ''}">${t ? '保存する' : '作る'}</button></div>`;
}
const sel2 = (id, label, opts, cur) => `<div><label>${label}</label><select id="${id}">${opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(cur) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;
A.newTable = () => { $('#tblform').innerHTML = tableForm(null); $('#tblform').scrollIntoView({ behavior: 'smooth' }); };
A.editTable = v => { const t = S.data.house.tables.find(x => x.id === Number(v)); $('#tblform').innerHTML = tableForm(t); $('#tblform').scrollIntoView({ behavior: 'smooth' }); };
A.saveTable = async v => {
  const settings = { seats: num('tf_seats'), upEnabled: val('tf_up') === '1', ante: num('tf_ante'), minBet: num('tf_min'), limit: num('tf_limit'), limitType: val('tf_lt'), upLimit: num('tf_uplimit'), upLimitType: val('tf_ult'), upResetOnOya: val('tf_urs') !== '0', gameMaxBets: num('tf_gmb'), gameMaxUps: num('tf_gmu'), startMode: val('tf_mode'), chips: num('tf_chips'), minPlayers: num('tf_minp'), durationMin: num('tf_dur'), endZero: num('tf_zero'), lateJoin: val('tf_late'), leave: val('tf_leave'), chat: val('tf_chat') === '1' };
  const r = await run(() => v ? api('PATCH', '/api/tables/' + v, { name: val('tf_name'), settings }) : api('POST', '/api/tables', { name: val('tf_name') || '卓', settings }), '保存しました');
  if (r) adminTab();
};

/* ---------- 広告(テスト表示) ----------
   本番の広告会社にはつないでいない。置く場所とタイミングを確かめるための仮の画面。
   ルール: ①ゲーム中の卓の画面には出さない ②全画面の広告は卓を出るときだけ。10分に1回まで ③作成者・統括責任者は「広告なし」 ④チップの景品にはしない(総量が決まっているため) */
const adOn = () => !!(S.me && S.me.ads) && !(S.me.user && (S.me.user.role === 'creator' || S.me.user.role === 'sovereign')) && !S.me.adFree;
function adBanner(tab) {
  if (!adOn() || !['home', 'pocket', 'notice'].includes(tab)) return '';
  return `<div style="margin:14px 0 4px;border:1px dashed #3B5674;border-radius:3px;background:rgba(20,40,64,.5);height:58px;display:flex;align-items:center;justify-content:center;gap:10px;color:#8FA6BE;font-size:12px;letter-spacing:.08em"><span style="padding:1px 6px;border:1px solid #3B5674;border-radius:2px;font-size:10px">AD</span>広告枠(テスト表示) ・ ${e(tab)}</div>`;
}
function adCapped() { try { const t = Number(localStorage.getItem('adLast') || 0); return Date.now() - t < 10 * 60000; } catch (x) { return false; } }
function adShow(slot, done) {
  if (!adOn() || adCapped()) return done();
  try { localStorage.setItem('adLast', String(Date.now())); } catch (x) {}
  const ov = document.createElement('div'); ov.id = 'adov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:999;background:#050D18;color:#EAF0F7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center';
  let left = 15;
  const paint = () => { ov.innerHTML = `<div style="font-size:11px;letter-spacing:.3em;color:#8FA6BE">AD ・ 広告(テスト表示)</div><div style="width:300px;height:170px;border:1px dashed #3B5674;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#5F7690;font-size:13px">動画広告の場所<br>(${e(slot)})</div><div style="width:300px;height:4px;background:#1B2D44"><div style="height:4px;background:#C9A24B;width:${(15 - left) / 15 * 100}%"></div></div><button id="adx" ${left > 10 ? 'disabled' : ''} style="height:44px;padding:0 24px;border:1px solid #C9A24B;border-radius:2px;background:transparent;color:#C9A24B;font-size:14px;font-weight:600;letter-spacing:.14em;opacity:${left > 10 ? .4 : 1}">${left > 10 ? (left - 10) + '秒後にスキップできます' : 'スキップ ▶'}</button>`; const b = ov.querySelector('#adx'); if (b) b.onclick = fin; };
  const fin = () => { clearInterval(iv); ov.remove(); done(); };
  const iv = setInterval(() => { left--; if (left <= 0) return fin(); paint(); }, 1000);
  paint(); document.body.appendChild(ov);
}
