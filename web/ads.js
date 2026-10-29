'use strict';
/* ソロ 広告の画面。
   決まり: ①ゲーム中の卓には出さない ②全画面は卓を出るときだけ・間隔をあける(設定) ③有料プランと作成者・統括責任者には出さない(サーバーでも判定)
           ④広告の見返りにチップは出さない(総量が決まっているため)
   出す順番: 地元スポンサー → 広告会社(Google AdSense。番号が設定され、利用者が「広告について」を確かめた後だけ) → 広告主の募集 */
const AD = { last: null, lastAt: 0, net: false };
const adCfg = () => (S.me && S.me.ad) || { on: false };
const adOn = () => !!adCfg().on;
const adConsent = () => { try { return localStorage.getItem('adConsent') || ''; } catch (x) { return 'np'; } };   // '' まだ / 'p' 興味に合わせる / 'np' 合わせない
function adBanner(tab) {
  if (!adOn() || !['home', 'wallet', 'notice'].includes(tab)) return '';
  return '<div id="adslot" class="adslot" aria-label="広告"></div>';
}
// 画面を描いたあとに広告を入れる(frame から呼ぶ)
async function adFill() {
  const el = $('#adslot'); if (!el) return;
  let ad = AD.last;
  if (!ad || Date.now() - AD.lastAt > 60000) {   // 同じ広告を1分は使い回す(画面を切り替えるたびに表示回数が増えないように)
    try { ad = (await api('GET', '/api/ads/pick?slot=banner')).ad; } catch (x) { ad = null; }
    AD.last = ad; AD.lastAt = Date.now();
  }
  if (!$('#adslot')) return;
  if (ad) { el.innerHTML = sponsorHTML(ad, false); return; }
  const net = adCfg().net;
  if (net && net.slot) {
    if (!adConsent()) { el.innerHTML = consentHTML(); return; }
    if (!adNetLoad(net)) return;
    el.innerHTML = `<div class="adlabel">広告</div><ins class="adsbygoogle" style="display:block;min-height:60px" data-ad-client="${e(net.client)}" data-ad-slot="${e(net.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (x) {}
    return;
  }
  el.innerHTML = `<a class="adhouse" href="/legal/sponsor" target="_blank" rel="noopener"><span class="adlabel">広告</span>この場所に、お店の広告を出しませんか</a>`;
}
function sponsorHTML(ad, full) {
  const img = ad.image ? `<img src="${e(ad.image)}" alt="" style="${full ? 'max-width:300px;max-height:220px' : 'width:56px;height:56px;object-fit:cover'};border-radius:3px">` : '';
  return `<button class="sponsor${full ? ' full' : ''}" data-a="adClick" data-v="${ad.id}" style="${ad.color ? 'border-color:' + e(ad.color) : ''}">${img}<span class="tx"><span class="adlabel">広告 ・ ${e(ad.name)}</span><b>${e(ad.text)}</b>${ad.url ? '<span class="mute">くわしく ›</span>' : ''}</span></button>`;
}
A.adClick = async v => { const r = await run(() => api('POST', '/api/ads/click', { id: Number(v) })); if (r && r.url) window.open(r.url, '_blank', 'noopener'); };
function consentHTML() {
  return `<div class="adconsent"><b>広告について</b><span class="mute">この場所に Google の広告を出すため、端末の情報(IPアドレス・Cookie など)が Google に送られます。<a href="/legal/external" target="_blank" rel="noopener">くわしく</a></span>
    <div class="row"><button class="btn sm" data-a="adConsent" data-v="np">興味に合わせない広告</button><button class="btn sm gold" data-a="adConsent" data-v="p">OK</button></div></div>`;
}
A.adConsent = v => { try { localStorage.setItem('adConsent', v === 'p' ? 'p' : 'np'); } catch (x) {} adFill(); };
A.adReset = () => { try { localStorage.removeItem('adConsent'); } catch (x) {} toast('広告の設定を戻しました。次に広告が出るときに、もう一度選べます'); };
// 広告会社の読み込み(1回だけ)。H5ゲーム広告(全画面)は Google の承認が出てから使う
function adNetLoad(net) {
  if (AD.net) return true;
  const ok = !!document.querySelector('script[src*="adsbygoogle.js"]') || (() => {
    const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(net.client);
    if (net.h5) s.setAttribute('data-ad-frequency-hint', (adCfg().gapMin || 10) + 'm');
    document.head.appendChild(s); return true; })();
  window.adsbygoogle = window.adsbygoogle || [];
  if (adConsent() !== 'p') window.adsbygoogle.requestNonPersonalizedAds = 1;
  if (net.h5) { window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); }; window.adConfig({ preloadAdBreaks: 'on', sound: 'off' }); }
  AD.net = ok; return ok;
}
function adCapped() { try { const t = Number(localStorage.getItem('adLast') || 0); return Date.now() - t < (adCfg().gapMin || 10) * 60000; } catch (x) { return false; } }
// 全画面: 卓を出るときだけ
async function adShow(slot, done) {
  if (!adOn() || adCapped()) return done();
  let ad = null; try { ad = (await api('GET', '/api/ads/pick?slot=full')).ad; } catch (x) {}
  const net = adCfg().net;
  if (!ad && net && net.h5 && adConsent() && adNetLoad(net) && typeof window.adBreak === 'function') {
    try { localStorage.setItem('adLast', String(Date.now())); } catch (x) {}
    let fin = false; const end = () => { if (!fin) { fin = true; done(); } };
    setTimeout(end, 8000);   // 広告が来なかったときも、8秒で先へ進む
    try { window.adBreak({ type: 'next', name: slot, adBreakDone: end }); } catch (x) { end(); }
    return;
  }
  if (!ad) return done();
  try { localStorage.setItem('adLast', String(Date.now())); } catch (x) {}
  const ov = document.createElement('div'); ov.id = 'adov'; ov.className = 'adov';
  let left = 8;
  const paint = () => { ov.innerHTML = `${sponsorHTML(ad, true)}<button id="adx" class="btn" ${left > 5 ? 'disabled' : ''}>${left > 5 ? (left - 5) + '秒後に閉じられます' : '閉じる ✕'}</button>`; const b = ov.querySelector('#adx'); if (b) b.onclick = fin; };
  const fin = () => { clearInterval(iv); ov.remove(); done(); };
  const iv = setInterval(() => { left--; if (left <= 0) return fin(); paint(); }, 1000);
  paint(); document.body.appendChild(ov);
}

/* ---------- 管理: 地元スポンサーの広告・売上(作成者・統括責任者) ---------- */
const dstr = ts => ts ? new Date(ts + 9 * 3600000).toISOString().slice(0, 10) : '';
const dnum = (s, end) => s ? new Date(s + (end ? 'T23:59:59+09:00' : 'T00:00:00+09:00')).getTime() : 0;
async function sponsorsCard() {
  let rows; try { rows = await api('GET', '/api/admin/sponsors'); } catch (x) { return ''; }
  S.data.sponsors = rows;
  const st = s => !s.active ? '<span class="pill">停止中</span>' : s.end_at && s.end_at < Date.now() ? '<span class="pill">期間終了</span>' : s.start_at > Date.now() ? '<span class="pill">開始前</span>' : '<span class="pill gold">掲載中</span>';
  return `<div class="card"><h3>SPONSORS<small>地元スポンサーの広告</small></h3>
  <p class="mute" style="margin-top:0">お店と直接契約して出す広告です。画像はこのサーバーから出すので、見た人の情報はお店に送られません。表示と、押された数を日ごとに数えます(請求のときの資料になります)。広告を出すには、設定の「広告」を 1 にしてください。いま: <b>${S.me.ads ? '出す' : '出さない'}</b></p>
  ${rows.length ? rows.map(s => `<div class="tbl-item"><div class="nm"><b>${e(s.name)}</b> ${st(s)}<br><span class="mute">${e(s.text)}</span><br><span class="mute">${{ banner: 'バナー', full: '全画面', both: 'バナー・全画面' }[s.slot]} ・ 重み${s.weight} ・ ${s.start_at ? dstr(s.start_at) : '今すぐ'}〜${s.end_at ? dstr(s.end_at) : '期限なし'}</span><br><span class="mute">30日: 表示 ${fmt(s.imp30)} ・ クリック ${fmt(s.clicks30)}(${s.imp30 ? (s.clicks30 / s.imp30 * 100).toFixed(1) : '0.0'}%) ・ 累計 ${fmt(s.impAll)} / ${fmt(s.clicksAll)}</span>
    ${s.recent.length ? `<details><summary class="mute">日ごと</summary><table class="t"><tr><th>日</th><th class="r">表示</th><th class="r">クリック</th></tr>${s.recent.slice().reverse().map(d => `<tr><td>${d.day}</td><td class="r">${fmt(d.imp)}</td><td class="r">${fmt(d.clicks)}</td></tr>`).join('')}</table></details>` : ''}</div>
    <div style="text-align:right"><button class="btn sm" data-a="spEdit" data-v="${s.id}">直す</button><br><button class="btn sm" style="margin-top:6px" data-a="spToggle" data-v="${s.id}">${s.active ? '止める' : '再開'}</button></div></div>`).join('') : '<p class="mute">まだありません。</p>'}
  <button class="btn gold block" style="margin-top:8px" data-a="spEdit" data-v="">広告を追加する</button><div id="spform"></div>
  <p class="mute">広告主の募集ページ: <a href="/legal/sponsor" target="_blank" rel="noopener" style="color:#C9A24B">/legal/sponsor</a>(料金と連絡先はサーバーの設定で入ります)</p></div>`;
}
A.spEdit = v => {
  const s = v ? S.data.sponsors.find(x => x.id === Number(v)) : { slot: 'both', weight: 1, active: 1 };
  S.data.spImg = undefined;
  $('#spform').innerHTML = `<div class="card" style="margin-top:10px"><h3>${v ? 'EDIT' : 'NEW'}<small>${v ? '広告を直す' : '広告を追加'}</small></h3>
    <label>お店・会社の名前<small>(30文字まで)</small></label><input id="sp_name" maxlength="30" value="${e(s.name || '')}">
    <label>広告の文<small>(60文字まで)</small></label><input id="sp_text" maxlength="60" value="${e(s.text || '')}">
    <label>押したときに開くページ<small>(https:// から。なくてもよい)</small></label><input id="sp_url" inputmode="url" value="${e(s.url || '')}" placeholder="https://">
    <label>画像<small>(PNG・JPEG。自動で小さくします${v && s.image ? '。選ばなければ今の画像のまま' : ''})</small></label><input id="sp_img" type="file" accept="image/png,image/jpeg,image/webp">
    <div class="grid2"><div><label>出す場所</label><select id="sp_slot">${[['both', 'バナーと全画面'], ['banner', 'バナーだけ'], ['full', '全画面だけ']].map(o => `<option value="${o[0]}" ${s.slot === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div><div><label>重み<small>(1〜10。大きいほどよく出る)</small></label><input id="sp_w" type="number" min="1" max="10" value="${s.weight || 1}"></div></div>
    <div class="grid2"><div><label>始まりの日</label><input id="sp_start" type="date" value="${dstr(s.start_at)}"></div><div><label>終わりの日</label><input id="sp_end" type="date" value="${dstr(s.end_at)}"></div></div>
    <label>枠の色<small>(なくてもよい。例 #C9A24B)</small></label><input id="sp_color" maxlength="7" value="${e(s.color || '')}">
    <label>メモ<small>(契約・料金など。利用者には出ません)</small></label><input id="sp_note" maxlength="200" value="${e(s.note || '')}">
    <button class="btn gold block" style="margin-top:10px" data-a="spSave" data-v="${v || ''}">保存する</button></div>`;
  $('#spform').scrollIntoView({ behavior: 'smooth' });
};
// 画像を選んだら、横640px までに縮めて JPEG にする(サーバーの上限 約200KB に収めるため)
document.addEventListener('change', ev => {
  if (ev.target.id !== 'sp_img' || !ev.target.files[0]) return;
  const f = ev.target.files[0], rd = new FileReader();
  rd.onload = () => { const im = new Image(); im.onload = () => {
    let q = 0.85, w = Math.min(640, im.width), out;
    do { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(im.height * w / im.width); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); out = c.toDataURL('image/jpeg', q); q -= 0.15; if (q < 0.4) { w = Math.round(w * 0.75); q = 0.8; } } while (out.length > 280000 && w > 120);
    S.data.spImg = out; toast('画像を用意しました(' + Math.round(out.length / 1024) + 'KB)');
  }; im.onerror = () => toast('画像を読めませんでした', true); im.src = rd.result; };
  rd.readAsDataURL(f);
});
A.spSave = async v => {
  const b = { name: val('sp_name'), text: val('sp_text'), url: val('sp_url').trim(), slot: val('sp_slot'), weight: num('sp_w'), start_at: dnum(val('sp_start')), end_at: dnum(val('sp_end'), true), color: val('sp_color').trim(), note: val('sp_note') };
  if (S.data.spImg) b.image = S.data.spImg;
  const r = await run(() => v ? api('PATCH', '/api/admin/sponsors/' + v, b) : api('POST', '/api/admin/sponsors', b), '保存しました'); if (r) adminTab();
};
A.spToggle = async v => { const s = S.data.sponsors.find(x => x.id === Number(v)); if (await run(() => api('PATCH', '/api/admin/sponsors/' + v, { active: s.active ? 0 : 1 }), s.active ? '止めました' : '再開しました')) adminTab(); };
async function salesCard() {
  let r; try { r = await api('GET', '/api/admin/sales'); } catch (x) { return ''; }
  return `<div class="card"><h3>SALES<small>単品の売上(卓のテーマ)</small></h3><p>合計(返金を除く): <b>${fmt(r.total)}円</b></p>
  ${r.rows.length ? `<table class="t"><tr><th>日時</th><th>名前</th><th>商品</th><th class="r">円</th></tr>${r.rows.slice(0, 50).map(x => `<tr${x.revoked ? ' style="opacity:.5"' : ''}><td class="mute">${new Date(x.ts).toLocaleDateString('ja-JP')}</td><td>${e(x.user)}</td><td>${e(x.item)}${x.revoked ? ' (返金)' : ''}</td><td class="r">${x.price == null ? '-' : fmt(x.price)}</td></tr>`).join('')}</table>` : '<p class="mute">まだありません。</p>'}</div>`;
}
